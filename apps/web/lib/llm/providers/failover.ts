import type {
  LlmGenerateInput,
  LlmProvider,
  LlmResponse
} from "../types";

/**
 * FailoverProvider: wraps a primary provider and 0..N backup providers.
 *
 * Health model:
 *   - Each generate() attempt on a provider is recorded as success/failure
 *     within a rolling window (default last 5 calls).
 *   - If the primary's recent failure rate exceeds a threshold (default
 *     >=2 of the last 3 calls failed), route this call to the first
 *     healthy backup.
 *   - We still try the primary first on every call unless it was just
 *     marked as failed on the previous call within the current request
 *     — degraded providers are given a "skip this call" grace period.
 *
 * This is "constellation of models" reliability — same pattern Sierra and
 * Bedrock use. Keeps the agent loop provider-agnostic while still getting
 * automatic failover when a provider misbehaves.
 *
 * Not included (intentionally simple):
 *   - Circuit-breaker with time-based recovery (just in-memory counts).
 *   - Background health probes. Recovery happens the next time we try.
 *   - Cross-process state sharing. Health is per-instance.
 *
 * Contract unchanged: conforms to LlmProvider, never throws, surfaces
 * all errors via LlmResponse.error.
 */

type ProviderHealth = {
  recentOutcomes: boolean[]; // true = success, false = failure
  consecutiveFailures: number;
  lastFailureAt: number | null;
};

export type FailoverProviderConfig = {
  primary: LlmProvider;
  backups?: LlmProvider[];
  /** Rolling window size for health tracking. Default 5. */
  windowSize?: number;
  /** Skip the provider if it has this many recent failures. Default 2. */
  recentFailureThreshold?: number;
};

export class FailoverProvider implements LlmProvider {
  readonly name: string;
  readonly family: string;
  readonly model: string;
  private readonly providers: LlmProvider[];
  private readonly windowSize: number;
  private readonly recentFailureThreshold: number;
  private health = new Map<string, ProviderHealth>();

  constructor(config: FailoverProviderConfig) {
    this.providers = [config.primary, ...(config.backups ?? [])];
    this.windowSize = config.windowSize ?? 5;
    this.recentFailureThreshold = config.recentFailureThreshold ?? 2;
    this.name = `failover:${config.primary.name}${
      config.backups && config.backups.length > 0
        ? `(→${config.backups.map((p) => p.name).join(",")})`
        : ""
    }`;
    this.family = config.primary.family;
    this.model = config.primary.model;
  }

  async generate(input: LlmGenerateInput): Promise<LlmResponse> {
    const attemptLog: Array<{ provider: string; error: string | null }> = [];

    for (const provider of this.providers) {
      if (this.isDegraded(provider.name)) {
        attemptLog.push({
          provider: provider.name,
          error: "skipped (degraded)"
        });
        continue;
      }

      const response = await provider.generate(input);
      const succeeded = this.isSuccessful(response);
      const permanent = !succeeded && this.isPermanentError(response);
      this.recordOutcome(provider.name, succeeded, permanent);

      if (succeeded) {
        return response;
      }

      attemptLog.push({
        provider: provider.name,
        error: response.error ?? response.finishReason
      });
    }

    // All providers failed. Return the last response with a summary error.
    return {
      text: null,
      toolCalls: [],
      finishReason: "error",
      usage: {
        inputTokens: null,
        outputTokens: null,
        durationMs: 0
      },
      error: `All ${this.providers.length} provider(s) failed: ${attemptLog
        .map((a) => `${a.provider}: ${a.error}`)
        .join("; ")}`
    };
  }

  /** Reset health tracking. Useful for tests. */
  resetHealth(): void {
    this.health.clear();
  }

  /** Introspection for logging and dashboards. */
  describe(): {
    providers: Array<{
      name: string;
      degraded: boolean;
      recentSuccessRate: number;
      consecutiveFailures: number;
    }>;
  } {
    return {
      providers: this.providers.map((p) => {
        const h = this.health.get(p.name);
        const successes = h?.recentOutcomes.filter((v) => v).length ?? 0;
        const total = h?.recentOutcomes.length ?? 0;
        return {
          name: p.name,
          degraded: this.isDegraded(p.name),
          recentSuccessRate: total > 0 ? successes / total : 1,
          consecutiveFailures: h?.consecutiveFailures ?? 0
        };
      })
    };
  }

  private isDegraded(providerName: string): boolean {
    const h = this.health.get(providerName);
    if (!h) return false;
    const recentFailures = h.recentOutcomes.filter((v) => !v).length;
    return recentFailures >= this.recentFailureThreshold;
  }

  private isSuccessful(response: LlmResponse): boolean {
    if (response.finishReason === "error" || response.finishReason === "timeout") {
      return false;
    }
    // IMPORTANT: a "stop" response with no text and no tool calls (Gemini's
    // occasional empty candidate) is NOT treated as a FailoverProvider
    // failure — the agent loop has its own retry for this. If we treated
    // it as a failure, we'd unnecessarily fall over to the backup and miss
    // the chance to re-ask the primary.
    return true;
  }

  /**
   * Quota/auth/config errors are "permanent" in the sense that retrying in
   * the same request — or the next few — will not help. Flag them hard so
   * the provider is skipped for the rest of the window immediately.
   */
  private isPermanentError(response: LlmResponse): boolean {
    if (!response.error) return false;
    const e = response.error.toLowerCase();
    return (
      e.includes("quota") ||
      e.includes("billing") ||
      e.includes("insufficient") ||
      e.includes("401") ||
      e.includes("403") ||
      e.includes("authentication") ||
      e.includes("api key")
    );
  }

  private recordOutcome(providerName: string, succeeded: boolean, permanent = false): void {
    const h = this.health.get(providerName) ?? {
      recentOutcomes: [],
      consecutiveFailures: 0,
      lastFailureAt: null
    };
    if (permanent) {
      // Flag chronic failures: fill the window with failures so isDegraded
      // returns true immediately and stays true for the rest of this
      // instance's lifetime (recovery only via resetHealth).
      h.recentOutcomes = Array(this.windowSize).fill(false);
      h.consecutiveFailures = this.windowSize;
      h.lastFailureAt = Date.now();
      this.health.set(providerName, h);
      return;
    }
    h.recentOutcomes.push(succeeded);
    if (h.recentOutcomes.length > this.windowSize) {
      h.recentOutcomes.shift();
    }
    if (succeeded) {
      h.consecutiveFailures = 0;
    } else {
      h.consecutiveFailures += 1;
      h.lastFailureAt = Date.now();
    }
    this.health.set(providerName, h);
  }
}
