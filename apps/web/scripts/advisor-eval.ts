#!/usr/bin/env -S npx tsx
/**
 * Advisor agent evaluation harness.
 *
 * Runs a fixed set of canonical questions against the local advisor chat
 * endpoint in agent mode with debug=1, measures:
 *   - Router accuracy: did the deterministic router hit the expected
 *     specialist(s) for each question?
 *   - Grounded-answer rate: did the specialist(s) produce a final answer
 *     (not a parse_error, provider_error, or budget_exhausted)?
 *   - Tool usage: how many tool calls per specialist per question.
 *   - Latency.
 *
 * Snapshots each run's full result to scripts/eval-baselines/<ts>.json for
 * regression diffing later. Intentionally lightweight - no test runner,
 * no CI integration - just evidence.
 *
 * Usage:
 *   node apps/web/scripts/advisor-eval.ts
 *   node apps/web/scripts/advisor-eval.ts --url http://localhost:3001
 *
 * This file is invoked with tsx (not compiled). No workspace imports;
 * everything is self-contained.
 */

import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

type SpecialistName =
  | "spending-coach"
  | "goal-tracker"
  | "portfolio-analyst"
  | "tax-planner"
  | "retirement-pacer"
  | "general-advisor";

type CanonicalQuestion = {
  id: string;
  message: string;
  /** Which specialists SHOULD fire (router accuracy). */
  expectedSpecialists: SpecialistName[];
  /** If provided, measure whether these substrings appear in the final answer. */
  expectedInAnswer?: string[];
};

const CANONICAL: CanonicalQuestion[] = [
  // --- spending-coach ---
  {
    id: "spending-dining-trend",
    message: "Is my dining spending going up or down?",
    expectedSpecialists: ["spending-coach"]
  },
  {
    id: "spending-amazon-total",
    message: "How much did I spend at Amazon over the last three months?",
    expectedSpecialists: ["spending-coach"]
  },
  {
    id: "spending-subscriptions",
    message: "Show me my recurring subscriptions.",
    expectedSpecialists: ["spending-coach"]
  },
  // --- goal-tracker ---
  {
    id: "goal-list-progress",
    message: "How am I doing on my goals?",
    expectedSpecialists: ["goal-tracker"]
  },
  {
    id: "goal-commit-new",
    message: "I want to commit to saving $20,000 for a down payment by the end of 2027.",
    expectedSpecialists: ["goal-tracker"]
  },
  // --- portfolio-analyst ---
  {
    id: "portfolio-allocation-overview",
    message: "How is my portfolio allocated between retirement and taxable?",
    expectedSpecialists: ["portfolio-analyst"]
  },
  {
    id: "portfolio-concentration",
    message: "Am I too concentrated in any single holding?",
    expectedSpecialists: ["portfolio-analyst"]
  },
  // --- tax-planner ---
  {
    id: "tax-401k-limit",
    message: "What is the 401k contribution limit this year and how close am I?",
    expectedSpecialists: ["tax-planner"]
  },
  {
    id: "tax-roth-ira-phaseout",
    message: "Am I above the Roth IRA phaseout for single filers?",
    expectedSpecialists: ["tax-planner"]
  },
  // --- retirement-pacer ---
  {
    id: "retirement-pacing",
    message: "Am I on pace for retirement given my age?",
    expectedSpecialists: ["retirement-pacer"]
  },
  {
    id: "retirement-catchup",
    message: "Should I think about catchup contributions yet?",
    expectedSpecialists: ["retirement-pacer"]
  },
  // --- general-advisor (fallback) ---
  {
    id: "general-overall",
    message: "How am I doing overall?",
    expectedSpecialists: ["general-advisor"]
  },
  {
    id: "general-fuzzy",
    message: "Give me a quick snapshot of where things stand.",
    expectedSpecialists: ["general-advisor"]
  },
  // --- multi-domain ---
  {
    id: "multi-retirement-tax",
    message: "Am I contributing too much to my 401k? How close am I to the IRS limit?",
    expectedSpecialists: ["tax-planner", "retirement-pacer"]
  },
  {
    id: "multi-spending-goal",
    message: "I want to cut my dining spending in half and track that as a goal.",
    expectedSpecialists: ["spending-coach", "goal-tracker"]
  },
  {
    id: "multi-portfolio-retirement",
    message: "Is my retirement allocation aggressive enough for someone my age?",
    expectedSpecialists: ["portfolio-analyst", "retirement-pacer"]
  },
  {
    id: "multi-full-sweep",
    message: "Look at my spending, retirement, and portfolio together and tell me what to focus on.",
    expectedSpecialists: [
      "spending-coach",
      "portfolio-analyst",
      "retirement-pacer"
    ]
  }
];

type EvalResult = {
  question: CanonicalQuestion;
  ok: boolean;
  error: string | null;
  routerCorrect: boolean;
  specialistsInvoked: SpecialistName[];
  synthesized: boolean;
  latencyMs: number;
  answer: string | null;
  answerContainsAll: boolean | null;
  toolCallTotals: Record<string, number>;
  specialistsOk: Record<string, boolean>;
  stoppedReasons: Record<string, string>;
};

type EvalReport = {
  ranAt: string;
  baseUrl: string;
  results: EvalResult[];
  summary: {
    total: number;
    routerCorrectCount: number;
    routerAccuracyPercent: number;
    allAnsweredCount: number;
    anyFailedCount: number;
    multiDomainSynthesizedCount: number;
    avgLatencyMs: number;
  };
};

function parseArgs() {
  let baseUrl = "http://localhost:3001";
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--url" && args[i + 1]) {
      baseUrl = args[i + 1];
      i += 1;
    }
  }
  return { baseUrl };
}

function setsEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const aSet = new Set(a);
  return b.every((entry) => aSet.has(entry));
}

async function runOne(
  baseUrl: string,
  question: CanonicalQuestion
): Promise<EvalResult> {
  const start = Date.now();
  let body: Record<string, unknown> = {};
  let error: string | null = null;
  try {
    const simSecret = process.env.SIM_SECRET;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (simSecret) headers.Authorization = `Bearer ${simSecret}`;
    const response = await fetch(
      `${baseUrl}/api/advisor/chat?mode=agent&debug=1`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ message: question.message }),
        signal: AbortSignal.timeout(90_000)
      }
    );
    body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      error = `HTTP ${response.status}: ${body.error ?? "unknown"}`;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const latencyMs = Date.now() - start;

  const specialistsInvoked = (body.specialistsInvoked ?? []) as SpecialistName[];
  const synthesized = (body.synthesized ?? false) as boolean;
  const answer = (body.answer as string) ?? null;

  const routerCorrect = setsEqual(
    question.expectedSpecialists,
    specialistsInvoked
  );

  const answerContainsAll = question.expectedInAnswer
    ? question.expectedInAnswer.every((needle) =>
        answer ? answer.toLowerCase().includes(needle.toLowerCase()) : false
      )
    : null;

  const debug = (body.debug ?? {}) as Record<string, unknown>;
  const specialists = (debug.specialists ?? []) as Array<{
    specialist: string;
    ok: boolean;
    toolCallCount: number;
    stoppedReason: string;
  }>;
  const toolCallTotals: Record<string, number> = {};
  const specialistsOk: Record<string, boolean> = {};
  const stoppedReasons: Record<string, string> = {};
  for (const s of specialists) {
    toolCallTotals[s.specialist] = s.toolCallCount;
    specialistsOk[s.specialist] = s.ok;
    stoppedReasons[s.specialist] = s.stoppedReason;
  }

  return {
    question,
    ok: error === null && answer !== null,
    error,
    routerCorrect,
    specialistsInvoked,
    synthesized,
    latencyMs,
    answer,
    answerContainsAll,
    toolCallTotals,
    specialistsOk,
    stoppedReasons
  };
}

function formatSummary(report: EvalReport) {
  const { summary } = report;
  return [
    `Ran ${summary.total} canonical questions against ${report.baseUrl}`,
    `  Router accuracy: ${summary.routerCorrectCount}/${summary.total} = ${summary.routerAccuracyPercent.toFixed(0)}%`,
    `  Produced final answer: ${summary.allAnsweredCount}/${summary.total}`,
    `  Specialist-run errors: ${summary.anyFailedCount}/${summary.total}`,
    `  Multi-domain synthesized: ${summary.multiDomainSynthesizedCount}`,
    `  Average latency: ${summary.avgLatencyMs.toFixed(0)} ms`
  ].join("\n");
}

function formatRow(result: EvalResult) {
  const pass = result.routerCorrect ? "✓" : "✗";
  const ok = result.ok ? "ok" : "FAIL";
  const synth = result.synthesized ? " (synth)" : "";
  const specialists = result.specialistsInvoked.join(",") || "(none)";
  const expected = result.question.expectedSpecialists.join(",");
  return (
    `  ${pass} [${result.question.id.padEnd(28)}] ${ok.padEnd(5)} ${result.latencyMs}ms${synth}\n` +
    `        got=${specialists}${result.routerCorrect ? "" : `  EXPECTED=${expected}`}\n` +
    (result.error ? `        error=${result.error}\n` : "") +
    (result.answer
      ? `        "${result.answer.slice(0, 120).replace(/\n/g, " ")}..."\n`
      : "")
  );
}

async function main() {
  const { baseUrl } = parseArgs();
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const baselinesDir = join(scriptDir, "eval-baselines");
  mkdirSync(baselinesDir, { recursive: true });

  console.log(
    `\n=== Advisor Eval Harness ===\nBase URL: ${baseUrl}\nQuestions: ${CANONICAL.length}\n`
  );

  const results: EvalResult[] = [];
  for (const question of CANONICAL) {
    process.stdout.write(`  running ${question.id}... `);
    const result = await runOne(baseUrl, question);
    results.push(result);
    process.stdout.write(
      `${result.ok ? "✓" : "✗"} router=${result.routerCorrect ? "✓" : "✗"} ${result.latencyMs}ms\n`
    );
  }

  const routerCorrectCount = results.filter((r) => r.routerCorrect).length;
  const allAnsweredCount = results.filter((r) => r.ok).length;
  const anyFailedCount = results.filter((r) => !r.ok).length;
  const multiDomainSynthesizedCount = results.filter((r) => r.synthesized).length;
  const avgLatencyMs =
    results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length;

  const report: EvalReport = {
    ranAt: new Date().toISOString(),
    baseUrl,
    results,
    summary: {
      total: results.length,
      routerCorrectCount,
      routerAccuracyPercent: (routerCorrectCount / results.length) * 100,
      allAnsweredCount,
      anyFailedCount,
      multiDomainSynthesizedCount,
      avgLatencyMs
    }
  };

  const baselineFile = join(
    baselinesDir,
    `${report.ranAt.replace(/[:.]/g, "-")}.json`
  );
  writeFileSync(baselineFile, JSON.stringify(report, null, 2));

  console.log("\n--- Details ---");
  for (const r of results) {
    console.log(formatRow(r));
  }

  console.log("\n--- Summary ---");
  console.log(formatSummary(report));
  console.log(`\nSaved baseline: ${baselineFile}`);

  // Compare against most-recent previous baseline if one exists.
  const allBaselines = readdirSync(baselinesDir)
    .filter((file) => file.endsWith(".json"))
    .sort();
  if (allBaselines.length >= 2) {
    const prevFile = allBaselines[allBaselines.length - 2];
    const prev = JSON.parse(
      readFileSync(join(baselinesDir, prevFile), "utf8")
    ) as EvalReport;
    console.log(
      `\n--- Diff vs previous baseline (${prevFile}) ---\n` +
        `  Router accuracy: ${prev.summary.routerAccuracyPercent.toFixed(0)}% -> ${report.summary.routerAccuracyPercent.toFixed(0)}%\n` +
        `  Answered: ${prev.summary.allAnsweredCount} -> ${report.summary.allAnsweredCount}\n` +
        `  Avg latency: ${prev.summary.avgLatencyMs.toFixed(0)}ms -> ${report.summary.avgLatencyMs.toFixed(0)}ms`
    );
  }

  // Exit non-zero if router accuracy below 90% (our stated exit criterion).
  if (report.summary.routerAccuracyPercent < 90) {
    console.error(
      `\nFAIL: router accuracy ${report.summary.routerAccuracyPercent.toFixed(0)}% is below 90% threshold.`
    );
    process.exit(1);
  }
  if (report.summary.anyFailedCount > 0) {
    console.error(
      `\nFAIL: ${report.summary.anyFailedCount} question(s) failed to produce a grounded answer.`
    );
    process.exit(1);
  }

  console.log("\nOK");
}

main().catch((err) => {
  console.error("Eval run crashed:", err);
  process.exit(2);
});
