#!/usr/bin/env -S npx tsx
/**
 * Regression gate.
 *
 * Runs the three baselines in sequence and checks each against its
 * pre-Week-4 numbers stored under regression-baselines/pre-week4/.
 * Exits non-zero if any baseline regresses by more than the threshold.
 *
 * Usage:
 *   npx tsx scripts/regression-gate.ts
 *
 * This script exists so every agent-touching change can be gated by a
 * single command that says pass/fail. Intentionally simple.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

type SuiteResult = {
  name: string;
  passed: number;
  total: number;
  metric: string;
  meta?: Record<string, unknown>;
};

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const baselineDir = join(rootDir, "regression-baselines", "pre-week4");
const currentDir = join(rootDir, "regression-baselines", "current");

function run(cmd: string, args: string[]): string {
  const result = spawnSync(cmd, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return (result.stdout ?? "") + (result.stderr ?? "");
}

function parseEvalV2(output: string): SuiteResult {
  // "Regression pass^N: X/Y"   "Capability pass@N: X/Y"
  const regression = output.match(/Regression pass\^\d+: (\d+)\/(\d+)/);
  const capability = output.match(/Capability pass@\d+: (\d+)\/(\d+)/);
  const router = output.match(/Router accuracy across all trials: (\d+)%/);
  return {
    name: "eval-v2",
    passed: regression ? Number(regression[1]) : 0,
    total: regression ? Number(regression[2]) : 0,
    metric: "regression pass^k",
    meta: {
      capability: capability
        ? `${capability[1]}/${capability[2]}`
        : "unknown",
      routerPercent: router ? Number(router[1]) : 0
    }
  };
}

function parseScriptedSims(output: string): SuiteResult {
  const m = output.match(/Passed: (\d+)\/(\d+)/);
  return {
    name: "scripted-sims",
    passed: m ? Number(m[1]) : 0,
    total: m ? Number(m[2]) : 0,
    metric: "scripted sims passed"
  };
}

function parseEvalV1(output: string): SuiteResult {
  const router = output.match(/Router accuracy: (\d+)\/(\d+)/);
  const answered = output.match(/Produced final answer: (\d+)\/(\d+)/);
  return {
    name: "eval-v1",
    passed: answered ? Number(answered[1]) : 0,
    total: answered ? Number(answered[2]) : 0,
    metric: "produced final answer",
    meta: {
      routerAccuracy: router ? `${router[1]}/${router[2]}` : "unknown"
    }
  };
}

function readBaseline(name: string): SuiteResult | null {
  const file = join(baselineDir, `${name}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeCurrent(name: string, result: SuiteResult) {
  mkdirSync(currentDir, { recursive: true });
  writeFileSync(
    join(currentDir, `${name}.json`),
    JSON.stringify(result, null, 2)
  );
}

function compare(current: SuiteResult, baseline: SuiteResult | null): {
  regressed: boolean;
  delta: string;
} {
  if (!baseline) {
    return { regressed: false, delta: "no baseline (recorded as new baseline)" };
  }
  const delta = current.passed - baseline.passed;
  if (delta < 0) {
    return {
      regressed: true,
      delta: `${baseline.passed}/${baseline.total} → ${current.passed}/${current.total} (LOST ${-delta})`
    };
  }
  if (delta > 0) {
    return {
      regressed: false,
      delta: `${baseline.passed}/${baseline.total} → ${current.passed}/${current.total} (+${delta})`
    };
  }
  return {
    regressed: false,
    delta: `${baseline.passed}/${baseline.total} (unchanged)`
  };
}

async function main() {
  console.log("\n=== Regression gate ===\n");

  const suites: SuiteResult[] = [];

  console.log("  Running eval v2 (trials=2)...");
  const evalV2Out = run("npx", [
    "tsx",
    "apps/web/scripts/advisor-eval-v2.ts",
    "--trials",
    "2"
  ]);
  const evalV2 = parseEvalV2(evalV2Out);
  suites.push(evalV2);
  console.log(`    regression=${evalV2.passed}/${evalV2.total} capability=${evalV2.meta?.capability} router=${evalV2.meta?.routerPercent}%`);

  console.log("  Running scripted sims...");
  const simsOut = run("npx", ["tsx", "simulations/runner.ts", "--mode", "scripted"]);
  const sims = parseScriptedSims(simsOut);
  suites.push(sims);
  console.log(`    passed=${sims.passed}/${sims.total}`);

  console.log("  Running eval v1...");
  const evalV1Out = run("npx", ["tsx", "apps/web/scripts/advisor-eval.ts"]);
  const evalV1 = parseEvalV1(evalV1Out);
  suites.push(evalV1);
  console.log(`    answered=${evalV1.passed}/${evalV1.total}`);

  console.log("\n--- Comparison to pre-Week-4 baseline ---");
  let anyRegressed = false;
  for (const s of suites) {
    const baseline = readBaseline(s.name);
    const cmp = compare(s, baseline);
    const mark = cmp.regressed ? "✗" : "✓";
    console.log(`  ${mark} ${s.name.padEnd(16)} ${cmp.delta}`);
    writeCurrent(s.name, s);
    if (cmp.regressed) anyRegressed = true;
  }

  if (anyRegressed) {
    console.error("\nREGRESSED. Review the individual suite outputs and fix.");
    process.exit(1);
  }
  console.log("\nOK: no regressions detected.");
}

main().catch((err) => {
  console.error("Regression gate crashed:", err);
  process.exit(2);
});
