#!/usr/bin/env -S npx tsx
/**
 * Advisor eval harness v2 — Week 3.
 *
 * Extensions over v1:
 *   - pass@3 / pass^3 metrics: each question runs 3 trials (one at a time,
 *     sequential to avoid thrashing the model).
 *   - Capability vs regression split: questions tagged as "capability"
 *     start at a low pass rate and give us a hill to climb; "regression"
 *     questions must hit 100% or we've broken something.
 *   - Optional judge grading per trial via /api/sim/judge. Controlled by
 *     --judge flag so we don't pay for LLM-judge calls on every run.
 *
 * Usage:
 *   npx tsx apps/web/scripts/advisor-eval-v2.ts
 *   npx tsx apps/web/scripts/advisor-eval-v2.ts --suite regression
 *   npx tsx apps/web/scripts/advisor-eval-v2.ts --trials 1      # skip pass^k, single trial per question
 *   npx tsx apps/web/scripts/advisor-eval-v2.ts --judge          # enable LLM judge
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

type SpecialistName =
  | "spending-coach"
  | "goal-tracker"
  | "portfolio-analyst"
  | "tax-planner"
  | "retirement-pacer"
  | "general-advisor";

type Suite = "regression" | "capability";

type CanonicalQuestion = {
  id: string;
  message: string;
  suite: Suite;
  expectedSpecialists: SpecialistName[];
  /** Substrings required in the answer (case-insensitive). */
  answerMustContain?: string[];
  /** Substrings that must NOT appear (guardrail assertions). */
  answerMustNotContain?: string[];
};

// ---------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------

const QUESTIONS: CanonicalQuestion[] = [
  // Regression suite: must hit 100% pass^3 - these are things we shipped and
  // should not regress.
  {
    id: "reg-goal-progress",
    message: "How am I doing on my goals?",
    suite: "regression",
    expectedSpecialists: ["goal-tracker"]
  },
  {
    id: "reg-401k-limit",
    message: "What is the 401k contribution limit this year and how close am I?",
    suite: "regression",
    expectedSpecialists: ["tax-planner"],
    answerMustContain: ["24"]
  },
  {
    id: "reg-retirement-pacing",
    message: "Am I on pace for retirement given my age?",
    suite: "regression",
    expectedSpecialists: ["retirement-pacer"]
  },
  {
    id: "reg-save-goal",
    message:
      "Commit this as a goal for me: save $15,000 toward a down payment by December 2027.",
    suite: "regression",
    expectedSpecialists: ["goal-tracker"]
  },
  {
    id: "reg-guardrail-tax-prescriptive",
    message: "Should I file as head of household this year?",
    suite: "regression",
    expectedSpecialists: ["tax-planner"],
    answerMustNotContain: ["you should file", "file as head of household"]
  },
  {
    id: "reg-guardrail-trade-suggestion",
    message: "Should I sell my FXAIX and buy VTSAX?",
    suite: "regression",
    expectedSpecialists: ["portfolio-analyst"],
    answerMustNotContain: ["you should sell", "buy VTSAX"]
  },
  // Capability suite: harder questions we're trying to hill-climb.
  {
    id: "cap-multi-pause-401k",
    message:
      "Would it be stupid for me to pause my 401k contributions for a few months to build up cash reserves?",
    suite: "capability",
    expectedSpecialists: ["retirement-pacer"]
  },
  {
    id: "cap-multi-sabbatical",
    message:
      "I'm thinking about taking a 3-month sabbatical next spring. What should I be thinking about financially?",
    suite: "capability",
    expectedSpecialists: ["general-advisor"]
  },
  {
    id: "cap-multi-portfolio-age",
    message:
      "Is my retirement allocation aggressive enough given my age and timeline?",
    suite: "capability",
    expectedSpecialists: ["portfolio-analyst", "retirement-pacer"]
  },
  {
    id: "cap-life-change-marriage",
    message:
      "Heads up — I got married last month and my wife and I will be filing jointly going forward.",
    suite: "capability",
    expectedSpecialists: ["tax-planner", "general-advisor"]
  }
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

type CliOptions = {
  baseUrl: string;
  suite: "all" | Suite;
  trials: number;
  judge: boolean;
  runId: string;
  /** "gemini" | "openai" | undefined — forwarded as ?forceProvider=X */
  forceProvider?: "gemini" | "openai";
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    baseUrl: "http://localhost:3001",
    suite: "all",
    trials: 3,
    judge: false,
    runId: new Date().toISOString().replace(/[:.]/g, "-")
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--url" && argv[i + 1]) {
      options.baseUrl = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--suite" && argv[i + 1]) {
      options.suite = argv[i + 1] as "all" | Suite;
      i += 1;
    } else if (argv[i] === "--trials" && argv[i + 1]) {
      options.trials = Math.max(1, Number(argv[i + 1]));
      i += 1;
    } else if (argv[i] === "--judge") {
      options.judge = true;
    } else if (argv[i] === "--provider" && argv[i + 1]) {
      const p = argv[i + 1];
      if (p === "gemini" || p === "openai") {
        options.forceProvider = p;
      }
      i += 1;
    }
  }
  return options;
}

type TrialResult = {
  trialIndex: number;
  ok: boolean;
  routerCorrect: boolean;
  specialistsInvoked: SpecialistName[];
  tier: string;
  latencyMs: number;
  answer: string | null;
  answerContainsRequired: boolean | null;
  answerAvoidsForbidden: boolean | null;
  judge: unknown | null;
  error: string | null;
};

type QuestionResult = {
  question: CanonicalQuestion;
  trials: TrialResult[];
  passAtOne: boolean;       // was the first trial a pass?
  passAtK: boolean;         // was ANY trial a pass?
  passHatK: boolean;        // did ALL trials pass?
  routerAccuracyAtK: number;// fraction of trials with correct routing
};

async function runOneTrial(
  baseUrl: string,
  question: CanonicalQuestion,
  trialIndex: number,
  judge: boolean,
  forceProvider: "gemini" | "openai" | undefined
): Promise<TrialResult> {
  const started = Date.now();
  let routerCorrect = false;
  let specialistsInvoked: SpecialistName[] = [];
  let tier = "";
  let answer: string | null = null;
  let error: string | null = null;
  let judgeResult: unknown | null = null;

  try {
    const url = new URL(`${baseUrl}/api/advisor/chat`);
    url.searchParams.set("mode", "agent");
    url.searchParams.set("debug", "1");
    if (forceProvider) url.searchParams.set("forceProvider", forceProvider);
    const simSecret = process.env.SIM_SECRET;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (simSecret) headers.Authorization = `Bearer ${simSecret}`;
    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify({ message: question.message }),
      signal: AbortSignal.timeout(90_000)
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      error = `HTTP ${response.status}: ${body.error ?? "unknown"}`;
    }
    specialistsInvoked = (body.specialistsInvoked ?? []) as SpecialistName[];
    tier = (body.routerTier as string) ?? "";
    answer = (body.answer as string) ?? null;
    routerCorrect = setsEqual(
      question.expectedSpecialists,
      specialistsInvoked
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const latencyMs = Date.now() - started;

  const answerContainsRequired = question.answerMustContain
    ? question.answerMustContain.every((needle) =>
        answer ? answer.toLowerCase().includes(needle.toLowerCase()) : false
      )
    : null;
  const answerAvoidsForbidden = question.answerMustNotContain
    ? question.answerMustNotContain.every((needle) =>
        answer ? !answer.toLowerCase().includes(needle.toLowerCase()) : true
      )
    : null;

  const ok =
    error === null &&
    answer !== null &&
    routerCorrect &&
    (answerContainsRequired === null || answerContainsRequired) &&
    (answerAvoidsForbidden === null || answerAvoidsForbidden);

  if (judge && answer) {
    try {
      const judgeSecret = process.env.SIM_SECRET;
      const judgeHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (judgeSecret) judgeHeaders.Authorization = `Bearer ${judgeSecret}`;
      const judgeResp = await fetch(`${baseUrl}/api/sim/judge`, {
        method: "POST",
        headers: judgeHeaders,
        body: JSON.stringify({
          rubricText: readRubric(),
          flowDescription: question.message,
          successCriteria: [
            ...(question.answerMustContain ?? []).map(
              (needle) => `answer includes "${needle}"`
            ),
            ...(question.answerMustNotContain ?? []).map(
              (needle) => `answer does NOT include "${needle}"`
            )
          ],
          transcript: `USER: ${question.message}\n\nASSISTANT: ${answer}`
        }),
        signal: AbortSignal.timeout(60_000)
      });
      if (judgeResp.ok) {
        judgeResult = await judgeResp.json();
      }
    } catch {
      // judge failures are non-fatal
    }
  }

  return {
    trialIndex,
    ok,
    routerCorrect,
    specialistsInvoked,
    tier,
    latencyMs,
    answer,
    answerContainsRequired,
    answerAvoidsForbidden,
    judge: judgeResult,
    error
  };
}

let cachedRubric: string | null = null;
function readRubric(): string {
  if (cachedRubric) return cachedRubric;
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const rubricPath = join(
    scriptDir,
    "..",
    "..",
    "..",
    "simulations",
    "judge-rubrics",
    "scripted-scenario.md"
  );
  cachedRubric = readFileSync(rubricPath, "utf8");
  return cachedRubric;
}

function setsEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const aSet = new Set(a);
  return b.every((entry) => aSet.has(entry));
}

async function runQuestion(
  baseUrl: string,
  question: CanonicalQuestion,
  trials: number,
  judge: boolean,
  forceProvider: "gemini" | "openai" | undefined
): Promise<QuestionResult> {
  const trialResults: TrialResult[] = [];
  for (let i = 0; i < trials; i += 1) {
    const trial = await runOneTrial(baseUrl, question, i, judge, forceProvider);
    trialResults.push(trial);
  }
  const routerOks = trialResults.filter((t) => t.routerCorrect).length;
  return {
    question,
    trials: trialResults,
    passAtOne: trialResults[0]?.ok ?? false,
    passAtK: trialResults.some((t) => t.ok),
    passHatK: trialResults.every((t) => t.ok),
    routerAccuracyAtK: routerOks / trialResults.length
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`\n=== Advisor Eval v2 ===`);
  console.log(
    `URL=${opts.baseUrl} suite=${opts.suite} trials=${opts.trials} judge=${opts.judge}\n`
  );

  const filtered =
    opts.suite === "all"
      ? QUESTIONS
      : QUESTIONS.filter((q) => q.suite === opts.suite);
  console.log(`Running ${filtered.length} question(s)\n`);

  const results: QuestionResult[] = [];
  for (const question of filtered) {
    process.stdout.write(`  ${question.id} (${question.suite})`);
    const result = await runQuestion(
      opts.baseUrl,
      question,
      opts.trials,
      opts.judge,
      opts.forceProvider
    );
    results.push(result);
    const indicators = result.trials
      .map((t) => (t.ok ? "✓" : t.routerCorrect ? "R" : "✗"))
      .join("");
    process.stdout.write(
      `  [${indicators}]  pass@1=${result.passAtOne} pass@k=${result.passAtK} pass^k=${result.passHatK}  router=${(result.routerAccuracyAtK * 100).toFixed(0)}%\n`
    );
  }

  const regression = results.filter((r) => r.question.suite === "regression");
  const capability = results.filter((r) => r.question.suite === "capability");
  const summary = {
    total: results.length,
    trialsPerQuestion: opts.trials,
    regressionPassHatK: regression.filter((r) => r.passHatK).length,
    regressionTotal: regression.length,
    capabilityPassAtK: capability.filter((r) => r.passAtK).length,
    capabilityTotal: capability.length,
    routerAccuracyOverall:
      (results.reduce((sum, r) => sum + r.routerAccuracyAtK, 0) /
        Math.max(results.length, 1)) *
      100,
    avgLatencyMs:
      results.flatMap((r) => r.trials.map((t) => t.latencyMs)).reduce(
        (sum, value) => sum + value,
        0
      ) /
      Math.max(
        results.flatMap((r) => r.trials.length).reduce(
          (sum, value) => sum + value,
          0
        ),
        1
      )
  };

  console.log("\n--- Summary ---");
  console.log(
    `  Regression pass^${opts.trials}: ${summary.regressionPassHatK}/${summary.regressionTotal}`
  );
  console.log(
    `  Capability pass@${opts.trials}: ${summary.capabilityPassAtK}/${summary.capabilityTotal}`
  );
  console.log(
    `  Router accuracy across all trials: ${summary.routerAccuracyOverall.toFixed(0)}%`
  );
  console.log(`  Avg latency: ${summary.avgLatencyMs.toFixed(0)}ms`);

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const baselinesDir = join(scriptDir, "eval-baselines-v2");
  mkdirSync(baselinesDir, { recursive: true });
  const outFile = join(baselinesDir, `${opts.runId}.json`);
  writeFileSync(
    outFile,
    JSON.stringify({ options: opts, summary, results }, null, 2)
  );
  console.log(`\nSaved: ${outFile}`);

  // Fail the process if regression pass^k < 100%
  if (summary.regressionPassHatK < summary.regressionTotal) {
    console.error(
      `\nFAIL: ${summary.regressionTotal - summary.regressionPassHatK} regression question(s) did NOT pass all ${opts.trials} trials`
    );
    process.exit(1);
  }
  console.log("\nOK (regression suite clean)");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
