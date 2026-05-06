import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@portfolio/db";
import { getOrCreateDefaultUser } from "@/lib/user";

/**
 * Read-only aggregate stats over recent RecommendationRun rows.
 *
 * Returns per-specialist counts/latency/token totals and a top-level
 * summary so dashboards can see cost-per-turn and p50/p95 latency.
 *
 * Intentionally lightweight: does one DB fetch and aggregates in JS.
 * Fine at our scale (hundreds of rows at most).
 *
 * Query params:
 *   ?limit=100  — max runs to scan (default 200)
 *   ?since=ISO  — only runs with createdAt >= given timestamp
 */

type SpecialistStats = {
  specialist: string;
  runs: number;
  oks: number;
  failures: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  avgTokensPerRun: number;
  avgToolCallsPerRun: number;
};

type AgentRunOutputPayload = {
  totalLatencyMs?: number;
  synthesized?: boolean;
  totals?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    modelCalls?: number;
    toolCalls?: number;
  };
  groundedness?: {
    grounded: boolean;
    confidence: number;
    issues: string[];
  } | null;
  specialists?: Array<{
    specialist: string;
    ok?: boolean;
    stoppedReason?: string;
    toolCallCount?: number;
    trace?: Array<{
      kind?: string;
      latencyMs?: number | null;
      inputTokens?: number | null;
      outputTokens?: number | null;
    }>;
  }>;
};

type AgentRunInputPayload = {
  mode?: string;
  routerSource?: string;
  routerTier?: string;
  specialistsInvoked?: string[];
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

export async function GET(request: NextRequest) {
  const limit = Math.min(
    Number(request.nextUrl.searchParams.get("limit") ?? 200),
    1000
  );
  const sinceParam = request.nextUrl.searchParams.get("since");
  const sinceDate = sinceParam ? new Date(sinceParam) : undefined;

  try {
    const user = await getOrCreateDefaultUser();
    const rows = await prisma.recommendationRun.findMany({
      where: {
        userId: user.id,
        ...(sinceDate && !Number.isNaN(sinceDate.getTime())
          ? { createdAt: { gte: sinceDate } }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        status: true,
        inputSnapshot: true,
        outputPayload: true
      }
    });

    // Filter to agent runs only (mode=agent in inputSnapshot).
    const agentRows = rows.filter((r) => {
      const input = r.inputSnapshot as AgentRunInputPayload | null;
      return input && input.mode === "agent";
    });

    // Per-specialist accumulators
    const bySpecialist = new Map<
      string,
      {
        runs: number;
        oks: number;
        failures: number;
        latencies: number[];
        inputTokens: number;
        outputTokens: number;
        toolCallCount: number;
      }
    >();

    let totalRuns = 0;
    let totalOks = 0;
    let totalSpecialistInvocations = 0;
    let totalSpecialistOks = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalLatencyMs = 0;
    let synthesizedCount = 0;
    let groundedCount = 0;
    let groundednessCheckedCount = 0;
    const tierCounts: Record<string, number> = { fast: 0, mid: 0, deep: 0 };
    const routerSourceCounts: Record<string, number> = {};

    for (const row of agentRows) {
      const input = row.inputSnapshot as AgentRunInputPayload;
      const output = row.outputPayload as AgentRunOutputPayload;
      totalRuns += 1;
      // A row-level OK means at least one specialist produced a final reply
      // and synthesis (or single-specialist passthrough) succeeded. We
      // approximate as row.status === 'succeeded' from the DB.
      if (row.status === "succeeded") totalOks += 1;

      if (input.routerTier) {
        tierCounts[input.routerTier] = (tierCounts[input.routerTier] ?? 0) + 1;
      }
      if (input.routerSource) {
        routerSourceCounts[input.routerSource] =
          (routerSourceCounts[input.routerSource] ?? 0) + 1;
      }
      if (output.synthesized) synthesizedCount += 1;
      totalLatencyMs += output.totalLatencyMs ?? 0;
      totalInputTokens += output.totals?.inputTokens ?? 0;
      totalOutputTokens += output.totals?.outputTokens ?? 0;

      if (output.groundedness) {
        groundednessCheckedCount += 1;
        if (output.groundedness.grounded) groundedCount += 1;
      }

      for (const sp of output.specialists ?? []) {
        const key = sp.specialist;
        totalSpecialistInvocations += 1;
        if (sp.ok) totalSpecialistOks += 1;
        const entry = bySpecialist.get(key) ?? {
          runs: 0,
          oks: 0,
          failures: 0,
          latencies: [],
          inputTokens: 0,
          outputTokens: 0,
          toolCallCount: 0
        };
        entry.runs += 1;
        if (sp.ok) {
          entry.oks += 1;
        } else {
          entry.failures += 1;
        }
        let specialistLatency = 0;
        for (const step of sp.trace ?? []) {
          if (step.kind === "model_call") {
            specialistLatency += step.latencyMs ?? 0;
            entry.inputTokens += step.inputTokens ?? 0;
            entry.outputTokens += step.outputTokens ?? 0;
          }
        }
        entry.latencies.push(specialistLatency);
        entry.toolCallCount += sp.toolCallCount ?? 0;
        bySpecialist.set(key, entry);
      }
    }

    const specialists: SpecialistStats[] = [];
    for (const [name, entry] of bySpecialist.entries()) {
      const sortedLatencies = entry.latencies.slice().sort((a, b) => a - b);
      const avgLatency =
        entry.latencies.reduce((sum, v) => sum + v, 0) /
        Math.max(entry.latencies.length, 1);
      specialists.push({
        specialist: name,
        runs: entry.runs,
        oks: entry.oks,
        failures: entry.failures,
        p50LatencyMs: percentile(sortedLatencies, 50),
        p95LatencyMs: percentile(sortedLatencies, 95),
        avgLatencyMs: Math.round(avgLatency),
        totalInputTokens: entry.inputTokens,
        totalOutputTokens: entry.outputTokens,
        totalTokens: entry.inputTokens + entry.outputTokens,
        avgTokensPerRun: Math.round(
          (entry.inputTokens + entry.outputTokens) / Math.max(entry.runs, 1)
        ),
        avgToolCallsPerRun: Number(
          (entry.toolCallCount / Math.max(entry.runs, 1)).toFixed(2)
        )
      });
    }
    specialists.sort((a, b) => b.runs - a.runs);

    return NextResponse.json({
      sample: {
        totalRuns,
        window: {
          limit,
          since: sinceDate?.toISOString() ?? null,
          oldest: agentRows[agentRows.length - 1]?.createdAt ?? null,
          newest: agentRows[0]?.createdAt ?? null
        }
      },
      summary: {
        totalOks,
        successRate:
          totalRuns > 0 ? Math.round((totalOks / totalRuns) * 100) : null,
        specialistSuccessRate:
          totalSpecialistInvocations > 0
            ? Math.round((totalSpecialistOks / totalSpecialistInvocations) * 100)
            : null,
        synthesizedCount,
        synthesizedRatePercent:
          totalRuns > 0 ? Math.round((synthesizedCount / totalRuns) * 100) : 0,
        avgTotalLatencyMs:
          totalRuns > 0 ? Math.round(totalLatencyMs / totalRuns) : 0,
        totalInputTokens,
        totalOutputTokens,
        avgInputTokensPerRun:
          totalRuns > 0 ? Math.round(totalInputTokens / totalRuns) : 0,
        avgOutputTokensPerRun:
          totalRuns > 0 ? Math.round(totalOutputTokens / totalRuns) : 0,
        groundedness: {
          checkedCount: groundednessCheckedCount,
          groundedCount,
          groundedRatePercent:
            groundednessCheckedCount > 0
              ? Math.round((groundedCount / groundednessCheckedCount) * 100)
              : null
        }
      },
      tierDistribution: tierCounts,
      routerSourceDistribution: routerSourceCounts,
      specialists
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to compute stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
