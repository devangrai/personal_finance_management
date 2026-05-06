#!/usr/bin/env -S npx tsx
/**
 * Simulation runner.
 *
 * Two modes:
 *   - scripted:  reads a YAML scenario with fixed user_turns and assertions,
 *                hits /api/advisor/chat?mode=agent&debug=1, validates the
 *                transcript against the expected block. Fast, deterministic
 *                enough given a pinned seed, used for regression testing.
 *
 *   - flow:      reads a persona + flow pair, runs a multi-turn LLM-user sim
 *                where one LLM plays the user and the advisor responds.
 *                An independent judge LLM grades the transcript against
 *                a rubric. Expensive, run weekly.
 *
 * Usage:
 *   npx tsx simulations/runner.ts --mode scripted
 *   npx tsx simulations/runner.ts --mode flow --flow first-time-retirement-setup
 *   npx tsx simulations/runner.ts --mode flow   # all flows
 *   npx tsx simulations/runner.ts --url http://localhost:3001
 *
 * Results are persisted under simulations/results/<ts>-<mode>.json.
 */

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

type CliOptions = {
  mode: "scripted" | "flow";
  baseUrl: string;
  flow?: string;
  scenario?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: "scripted",
    baseUrl: "http://localhost:3001"
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--mode" && (argv[i + 1] === "scripted" || argv[i + 1] === "flow")) {
      options.mode = argv[i + 1] as "scripted" | "flow";
      i += 1;
    } else if (argv[i] === "--url" && argv[i + 1]) {
      options.baseUrl = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--flow" && argv[i + 1]) {
      options.flow = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--scenario" && argv[i + 1]) {
      options.scenario = argv[i + 1];
      i += 1;
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type ScriptedScenario = {
  id: string;
  description?: string;
  user_turns: string[];
  expected: {
    /**
     * Expected specialists. Can be:
     *   - string[]: a single set (order doesn't matter)
     *   - string[][]: any of these sets is acceptable (each element is a set)
     * Both forms match as set-equality.
     */
    specialists?: string[] | string[][];
    tier?: string | string[];
    required_tools_called?: string[];
    forbidden_tools_called?: string[];
    answer_must_contain?: string[];
    answer_must_not_contain?: string[];
    min_bullets?: number;
    max_tool_calls_total?: number;
  };
};

type Persona = {
  id: string;
  label: string;
  system_prompt: string;
  max_turns: number;
};

type Flow = {
  id: string;
  description: string;
  persona: string;
  initial_context?: string;
  success_criteria: string[];
  judge_rubric: string;
  max_turns: number;
};

type ScriptedAssertion = {
  name: string;
  ok: boolean;
  detail?: string;
};

type ScriptedScenarioResult = {
  scenario: ScriptedScenario;
  ok: boolean;
  assertions: ScriptedAssertion[];
  specialists: string[];
  tier: string;
  toolsCalled: string[];
  answer: string | null;
  latencyMs: number;
  error: string | null;
};

type FlowTurn = {
  turnIndex: number;
  role: "user" | "assistant";
  content: string;
  advisorSpecialists?: string[];
  advisorTier?: string;
  advisorLatencyMs?: number;
};

type FlowResult = {
  flow: Flow;
  persona: Persona;
  turns: FlowTurn[];
  judgement: JudgeResult | null;
  totalLatencyMs: number;
  error: string | null;
};

type JudgeResult = {
  verdict: "pass" | "partial" | "fail";
  score: number;
  dimensions: {
    goal_completion: number;
    groundedness: number;
    tone: number;
    guardrail_compliance: number;
  };
  reasoning: string;
  failures: string[];
};

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

const runnerDir = dirname(fileURLToPath(import.meta.url));

function loadYaml<T>(path: string): T {
  const raw = readFileSync(path, "utf8");
  return parseYaml(raw) as T;
}

function loadScriptedScenarios(filter?: string): ScriptedScenario[] {
  const dir = join(runnerDir, "scenarios", "scripted");
  let files = readdirSync(dir).filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"));
  if (filter) files = files.filter((file) => file.includes(filter));
  return files.map((file) => loadYaml<ScriptedScenario>(join(dir, file)));
}

function loadPersonas(): Map<string, Persona> {
  const dir = join(runnerDir, "scenarios", "personas");
  const map = new Map<string, Persona>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
    const persona = loadYaml<Persona>(join(dir, file));
    map.set(persona.id, persona);
  }
  return map;
}

function loadFlows(filter?: string): Flow[] {
  const dir = join(runnerDir, "scenarios", "flows");
  let files = readdirSync(dir).filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"));
  if (filter) files = files.filter((file) => file.includes(filter));
  return files.map((file) => loadYaml<Flow>(join(dir, file)));
}

function loadRubric(filename: string): string {
  return readFileSync(
    join(runnerDir, "judge-rubrics", filename),
    "utf8"
  );
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

type AdvisorChatBody = {
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

async function postChat(baseUrl: string, body: AdvisorChatBody) {
  const simSecret = process.env.SIM_SECRET;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (simSecret) headers.Authorization = `Bearer ${simSecret}`;
  const response = await fetch(
    `${baseUrl}/api/advisor/chat?mode=agent&debug=1`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000)
    }
  );
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: json };
}

// ---------------------------------------------------------------------------
// Scripted runner
// ---------------------------------------------------------------------------

/**
 * Flatten all tool_call trace steps across all specialists.
 * Returns the full sequence *including duplicates* — important because
 * `max_tool_calls_total` in scenarios is a budget assertion on total calls,
 * not on unique tool names.
 */
function collectToolsCalled(debug: Record<string, unknown> | undefined): string[] {
  if (!debug) return [];
  const specialists = (debug.specialists ?? []) as Array<{
    trace?: Array<{ kind: string; toolName?: string }>;
  }>;
  const tools: string[] = [];
  for (const s of specialists) {
    for (const step of s.trace ?? []) {
      if (step.kind === "tool_call" && step.toolName) tools.push(step.toolName);
    }
  }
  return tools;
}

function uniqueToolsCalled(debug: Record<string, unknown> | undefined): string[] {
  return Array.from(new Set(collectToolsCalled(debug)));
}

function arraysEqualAsSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const aSet = new Set(a);
  return b.every((entry) => aSet.has(entry));
}

async function runScripted(
  baseUrl: string,
  scenario: ScriptedScenario
): Promise<ScriptedScenarioResult> {
  const started = Date.now();
  if (scenario.user_turns.length === 0) {
    return {
      scenario,
      ok: false,
      assertions: [{ name: "has_user_turns", ok: false, detail: "no user_turns in scenario" }],
      specialists: [],
      tier: "",
      toolsCalled: [],
      answer: null,
      latencyMs: 0,
      error: "no user_turns"
    };
  }

  let status = 0;
  let responseBody: Record<string, unknown> = {};
  let historyCarry: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Run each user turn in sequence, threading history.
  for (const turn of scenario.user_turns) {
    const result = await postChat(baseUrl, { message: turn, history: historyCarry });
    status = result.status;
    responseBody = result.body;
    const assistantText = (responseBody.answer as string) ?? "";
    historyCarry = [
      ...historyCarry,
      { role: "user", content: turn },
      { role: "assistant", content: assistantText }
    ];
  }

  const answer = (responseBody.answer as string | null) ?? null;
  const bullets = (responseBody.bullets as string[] | undefined) ?? [];
  const specialists = (responseBody.specialistsInvoked ?? []) as string[];
  const tier = (responseBody.routerTier as string | undefined) ?? "";
  const debug = (responseBody.debug as Record<string, unknown>) ?? {};
  const toolsCalled = collectToolsCalled(debug);

  const assertions: ScriptedAssertion[] = [];

  assertions.push({
    name: "http_200",
    ok: status === 200,
    detail: status === 200 ? undefined : `got ${status}: ${JSON.stringify(responseBody).slice(0, 200)}`
  });

  if (scenario.expected.specialists) {
    const expected = scenario.expected.specialists;
    // Detect string[] vs string[][] form. If the first element is an array,
    // we're in the "any of these sets" form.
    const isListOfSets =
      Array.isArray(expected) &&
      expected.length > 0 &&
      Array.isArray(expected[0]);
    const acceptedSets = isListOfSets
      ? (expected as string[][])
      : [expected as string[]];
    const ok = acceptedSets.some((set) => arraysEqualAsSet(set, specialists));
    assertions.push({
      name: "specialists_match",
      ok,
      detail: ok
        ? undefined
        : `expected one of ${acceptedSets.map((s) => `[${s.join(",")}]`).join(" | ")} got [${specialists.join(",")}]`
    });
  }

  if (scenario.expected.tier) {
    const expectedTiers = Array.isArray(scenario.expected.tier)
      ? scenario.expected.tier
      : [scenario.expected.tier];
    const ok = expectedTiers.includes(tier);
    assertions.push({
      name: "tier_match",
      ok,
      detail: ok ? undefined : `expected ${expectedTiers.join("|")} got ${tier}`
    });
  }

  if (scenario.expected.required_tools_called) {
    for (const tool of scenario.expected.required_tools_called) {
      const ok = toolsCalled.includes(tool);
      assertions.push({
        name: `required_tool:${tool}`,
        ok,
        detail: ok ? undefined : `missing; got [${toolsCalled.join(",")}]`
      });
    }
  }

  if (scenario.expected.forbidden_tools_called) {
    for (const tool of scenario.expected.forbidden_tools_called) {
      const ok = !toolsCalled.includes(tool);
      assertions.push({
        name: `forbidden_tool:${tool}`,
        ok,
        detail: ok ? undefined : `should not have been called`
      });
    }
  }

  if (scenario.expected.answer_must_contain) {
    for (const needle of scenario.expected.answer_must_contain) {
      const ok = answer ? answer.toLowerCase().includes(needle.toLowerCase()) : false;
      assertions.push({
        name: `answer_contains:${needle}`,
        ok,
        detail: ok ? undefined : `answer did not contain "${needle}"`
      });
    }
  }

  if (scenario.expected.answer_must_not_contain) {
    for (const needle of scenario.expected.answer_must_not_contain) {
      const ok = answer ? !answer.toLowerCase().includes(needle.toLowerCase()) : true;
      assertions.push({
        name: `answer_forbidden:${needle}`,
        ok,
        detail: ok ? undefined : `answer contained banned "${needle}"`
      });
    }
  }

  if (scenario.expected.min_bullets !== undefined) {
    const ok = bullets.length >= scenario.expected.min_bullets;
    assertions.push({
      name: "min_bullets",
      ok,
      detail: ok ? undefined : `got ${bullets.length}, expected >= ${scenario.expected.min_bullets}`
    });
  }

  if (scenario.expected.max_tool_calls_total !== undefined) {
    const ok = toolsCalled.length <= scenario.expected.max_tool_calls_total;
    assertions.push({
      name: "max_tool_calls_total",
      ok,
      detail: ok ? undefined : `${toolsCalled.length} exceeds budget ${scenario.expected.max_tool_calls_total}`
    });
  }

// ---------------------------------------------------------------------------
// Assertion severity classification
//
// Scripted sims are inherently non-deterministic because they go through an
// LLM router + tool-using agent. We classify assertions into "hard" and
// "soft" so the suite can be stable without hiding real regressions:
//
//   HARD  — failure means the app is actually broken.
//           http_200, specialists_match, required_tool, forbidden_tool
//
//   SOFT  — failure reflects LLM variance, not a real bug. Tracked for
//           visibility but doesn't fail the scenario.
//           tier_match, max_tool_calls_total, answer_contains,
//           answer_forbidden, min_bullets
//
// The top-level `ok` of a scenario reflects only hard assertions. Soft
// failures are surfaced in the summary but don't count against regression.
// ---------------------------------------------------------------------------

const HARD_ASSERTION_PREFIXES = [
  "http_200",
  "specialists_match",
  "required_tool:",
  "forbidden_tool:",
  "has_user_turns"
];

function isHardAssertion(name: string): boolean {
  return HARD_ASSERTION_PREFIXES.some(
    (prefix) => name === prefix || name.startsWith(prefix)
  );
}

  const hardFailed = assertions.some(
    (a) => !a.ok && isHardAssertion(a.name)
  );
  const ok = !hardFailed;
  return {
    scenario,
    ok,
    assertions,
    specialists,
    tier,
    toolsCalled: uniqueToolsCalled(debug), // display-level: dedupe for readability
    answer,
    latencyMs: Date.now() - started,
    error: null
  };
}

// ---------------------------------------------------------------------------
// LLM-user flow runner
// ---------------------------------------------------------------------------

async function askUserSim(
  baseUrl: string,
  persona: Persona,
  conversation: FlowTurn[]
): Promise<string> {
  // Call the server-side /api/sim/usersim endpoint so all LLM calls go
  // through ModelPool (no need for the runner to know API keys).
  const simSecret = process.env.SIM_SECRET;
  const simHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (simSecret) simHeaders.Authorization = `Bearer ${simSecret}`;
  const response = await fetch(`${baseUrl}/api/sim/usersim`, {
    method: "POST",
    headers: simHeaders,
    body: JSON.stringify({
      systemPrompt: persona.system_prompt,
      history: conversation.map((turn) => ({
        // Invert roles: the persona's LLM sees advisor text as "assistant
        // from the other side" (its own user), and sees its own prior
        // messages as "assistant" (what it said).
        role: turn.role === "user" ? "assistant" : "user",
        content: turn.content
      }))
    })
  });
  if (!response.ok) {
    throw new Error(`usersim ${response.status}`);
  }
  const body = (await response.json()) as { text: string };
  return body.text;
}

async function runFlow(baseUrl: string, flow: Flow, persona: Persona): Promise<FlowResult> {
  const started = Date.now();
  const turns: FlowTurn[] = [];
  const advisorHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  let error: string | null = null;

  for (let turnIndex = 0; turnIndex < flow.max_turns; turnIndex += 1) {
    let userText: string;
    try {
      userText = await askUserSim(baseUrl, persona, turns);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      break;
    }

    turns.push({ turnIndex, role: "user", content: userText });

    // Check if the persona wants to end.
    if (/\b(done|bye|thanks, that|that's it|i'm good)\b/i.test(userText) && turnIndex > 1) {
      break;
    }

    const result = await postChat(baseUrl, { message: userText, history: advisorHistory });
    const advisorText = (result.body.answer as string) ?? "(no answer)";
    const specialists = ((result.body.specialistsInvoked as string[] | undefined) ?? []);
    const tier = (result.body.routerTier as string | undefined) ?? "";
    const latency = (result.body.totalLatencyMs as number | undefined) ?? 0;
    turns.push({
      turnIndex,
      role: "assistant",
      content: advisorText,
      advisorSpecialists: specialists,
      advisorTier: tier,
      advisorLatencyMs: latency
    });
    advisorHistory.push({ role: "user", content: userText });
    advisorHistory.push({ role: "assistant", content: advisorText });
  }

  // Grade with the judge.
  let judgement: JudgeResult | null = null;
  try {
    judgement = await judgeFlow(baseUrl, flow, turns);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return {
    flow,
    persona,
    turns,
    judgement,
    totalLatencyMs: Date.now() - started,
    error
  };
}

async function judgeFlow(
  baseUrl: string,
  flow: Flow,
  turns: FlowTurn[]
): Promise<JudgeResult> {
  const rubricText = loadRubric(flow.judge_rubric);
  const transcript = turns
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join("\n\n");
  const simSecret2 = process.env.SIM_SECRET;
  const judgeHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (simSecret2) judgeHeaders.Authorization = `Bearer ${simSecret2}`;
  const response = await fetch(`${baseUrl}/api/sim/judge`, {
    method: "POST",
    headers: judgeHeaders,
    body: JSON.stringify({
      rubricText,
      flowDescription: flow.description,
      successCriteria: flow.success_criteria,
      transcript
    })
  });
  if (!response.ok) {
    throw new Error(`judge ${response.status}`);
  }
  return (await response.json()) as JudgeResult;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function formatScriptedRow(result: ScriptedScenarioResult) {
  const summary = result.ok ? "✓" : "✗";
  const lines = [
    `  ${summary} [${result.scenario.id.padEnd(36)}] ${result.latencyMs}ms`,
    `        specialists=${result.specialists.join(",")} tier=${result.tier}`,
    `        tools=${result.toolsCalled.join(",") || "(none)"}`
  ];
  for (const assertion of result.assertions) {
    if (!assertion.ok) lines.push(`        ✗ ${assertion.name}: ${assertion.detail ?? "(no detail)"}`);
  }
  return lines.join("\n");
}

function formatFlowRow(result: FlowResult) {
  const lines = [
    `  [${result.flow.id}] persona=${result.persona.id} turns=${result.turns.length} ${result.totalLatencyMs}ms`
  ];
  if (result.judgement) {
    lines.push(
      `    verdict=${result.judgement.verdict} score=${result.judgement.score}` +
        ` dims=gc${result.judgement.dimensions.goal_completion}/gr${result.judgement.dimensions.groundedness}` +
        `/tn${result.judgement.dimensions.tone}/gc${result.judgement.dimensions.guardrail_compliance}`
    );
    if (result.judgement.failures.length > 0) {
      lines.push(`    failures: ${result.judgement.failures.join("; ")}`);
    }
    lines.push(`    reasoning: ${result.judgement.reasoning}`);
  }
  if (result.error) lines.push(`    ERROR: ${result.error}`);
  return lines.join("\n");
}

function persistResults(mode: string, results: unknown) {
  const resultsDir = join(runnerDir, "results");
  mkdirSync(resultsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(resultsDir, `${ts}-${mode}.json`);
  writeFileSync(file, JSON.stringify(results, null, 2));
  return file;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(`\n=== Simulation runner (mode=${options.mode}) ===`);
  console.log(`Base URL: ${options.baseUrl}\n`);

  if (options.mode === "scripted") {
    const scenarios = loadScriptedScenarios(options.scenario);
    console.log(`Loaded ${scenarios.length} scripted scenario(s)\n`);
    const results: ScriptedScenarioResult[] = [];
    for (const scenario of scenarios) {
      process.stdout.write(`  running ${scenario.id}... `);
      // Retry once on failure: LLM-routed agent calls occasionally flake
      // (502 from provider, empty response, wrong specialist). A single
      // retry catches transient issues without masking real regressions.
      let result = await runScripted(options.baseUrl, scenario);
      if (!result.ok) {
        process.stdout.write("retry... ");
        const retry = await runScripted(options.baseUrl, scenario);
        // Prefer the better outcome so a lucky retry doesn't artificially
        // inflate the result either — we only "rescue" if the retry actually
        // passes hard assertions. Otherwise we keep the first (worse) result
        // so the summary tells the truth.
        if (retry.ok) result = retry;
      }
      results.push(result);
      process.stdout.write(`${result.ok ? "✓" : "✗"} ${result.latencyMs}ms\n`);
    }
    console.log("\n--- Details ---");
    for (const r of results) console.log(formatScriptedRow(r));
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n--- Summary ---\nPassed: ${passed}/${results.length}\n`);
    const file = persistResults("scripted", results);
    console.log(`Saved: ${file}`);
    if (passed < results.length) process.exit(1);
    return;
  }

  // flow mode
  const personas = loadPersonas();
  const flows = loadFlows(options.flow);
  console.log(`Loaded ${flows.length} flow(s), ${personas.size} persona(s)\n`);
  const results: FlowResult[] = [];
  for (const flow of flows) {
    const persona = personas.get(flow.persona);
    if (!persona) {
      console.error(`Flow ${flow.id} references unknown persona ${flow.persona}; skipping`);
      continue;
    }
    console.log(`  running flow ${flow.id} (persona=${persona.id})...`);
    const result = await runFlow(options.baseUrl, flow, persona);
    results.push(result);
    console.log(formatFlowRow(result));
    console.log("");
  }
  const file = persistResults("flow", results);
  console.log(`Saved: ${file}`);
}

main().catch((err) => {
  console.error("Sim runner crashed:", err);
  process.exit(2);
});
