import { getAppEnv } from "../env";
import { GeminiProvider } from "./providers/gemini";
import { OpenAIProvider } from "./providers/openai";
import { ScriptedProvider, type ScriptedProviderConfig } from "./providers/scripted";
import { FailoverProvider } from "./providers/failover";
import type { LlmProvider } from "./types";

/**
 * Role-based model pool.
 *
 * Different agent tasks have different demands (Sierra's "constellation of
 * models" principle). Instead of hardcoding one model everywhere, we look
 * up the right provider by *role*:
 *
 *   - "router":       fast + cheap classification model, ~500ms
 *   - "specialist":   mid-tier conversational reasoning
 *   - "synthesizer":  mid-tier (reuses specialist model typically)
 *   - "judge":        mid-tier reasoning, low temperature, used for eval/sim grading
 *   - "user-sim":     cheap model playing a user persona in simulations
 *   - "tier-fast":    simple lookup/retrieval answers
 *   - "tier-mid":     same as specialist
 *   - "tier-deep":    frontier reasoning for complex multi-domain questions
 *
 * Roles map to a "family preference" (which provider) and a model id.
 * Configuration order:
 *   1. Explicit overrides passed to buildModelPool()
 *   2. Environment-variable overrides (MODEL_ROLE_<ROLE>, e.g. MODEL_ROLE_ROUTER)
 *   3. Defaults below, which prefer Gemini when GEMINI_API_KEY is set,
 *      OpenAI when OPENAI_API_KEY is set, and scripted otherwise.
 *
 * The pool is constructed once per request. A shared cache isn't worth it
 * at our scale.
 */

export type ModelRole =
  | "router"
  | "specialist"
  | "synthesizer"
  | "judge"
  | "user-sim"
  | "tier-fast"
  | "tier-mid"
  | "tier-deep";

export type ProviderFamily = "gemini" | "openai" | "scripted";

export type ModelAssignment = {
  family: ProviderFamily;
  model: string;
};

export type ModelPoolOverrides = Partial<Record<ModelRole, ModelAssignment>>;

export type ModelPoolConfig = {
  overrides?: ModelPoolOverrides;
  /**
   * If provided, ALL roles use this scripted config. Used by the simulation
   * runner and scripted tests so nothing ever touches a live LLM.
   */
  scriptedOverride?: ScriptedProviderConfig;
  /**
   * Enable cross-family failover. When true, the pool wraps each role's
   * provider in a FailoverProvider whose backup is the equivalent role from
   * the *other* family (if that family is configured). Defaults to true
   * when both Gemini and OpenAI keys are present.
   */
  enableFailover?: boolean;
};

const DEFAULT_GEMINI_ASSIGNMENTS: Record<ModelRole, ModelAssignment> = {
  router: { family: "gemini", model: "gemini-2.5-flash-lite" },
  specialist: { family: "gemini", model: "gemini-2.5-flash" },
  synthesizer: { family: "gemini", model: "gemini-2.5-flash" },
  judge: { family: "gemini", model: "gemini-2.5-flash" },
  "user-sim": { family: "gemini", model: "gemini-2.5-flash-lite" },
  "tier-fast": { family: "gemini", model: "gemini-2.5-flash-lite" },
  "tier-mid": { family: "gemini", model: "gemini-2.5-flash" },
  "tier-deep": { family: "gemini", model: "gemini-2.5-pro" }
};

const DEFAULT_OPENAI_ASSIGNMENTS: Record<ModelRole, ModelAssignment> = {
  router: { family: "openai", model: "gpt-4.1-nano" },
  specialist: { family: "openai", model: "gpt-4.1-mini" },
  synthesizer: { family: "openai", model: "gpt-4.1-mini" },
  judge: { family: "openai", model: "gpt-4.1-mini" },
  "user-sim": { family: "openai", model: "gpt-4.1-nano" },
  "tier-fast": { family: "openai", model: "gpt-4.1-nano" },
  "tier-mid": { family: "openai", model: "gpt-4.1-mini" },
  "tier-deep": { family: "openai", model: "gpt-4.1" }
};

export class ModelPool {
  private assignments: Record<ModelRole, ModelAssignment>;
  private readonly env: ReturnType<typeof getAppEnv>;
  private readonly scriptedOverride?: ScriptedProviderConfig;
  private readonly enableFailover: boolean;
  private cache = new Map<string, LlmProvider>();

  constructor(config: ModelPoolConfig = {}) {
    this.env = getAppEnv();
    this.scriptedOverride = config.scriptedOverride;
    // Default: failover is on when both Gemini and OpenAI keys are present.
    this.enableFailover =
      config.enableFailover ??
      (Boolean(this.env.geminiApiKey) && Boolean(this.env.openAiApiKey));

    // Pick the default assignment family based on what's configured.
    // Prefer Gemini since that's what we've validated; OpenAI is a fallback.
    const hasGemini = Boolean(this.env.geminiApiKey);
    const hasOpenAi = Boolean(this.env.openAiApiKey);
    const defaults = hasGemini
      ? DEFAULT_GEMINI_ASSIGNMENTS
      : hasOpenAi
        ? DEFAULT_OPENAI_ASSIGNMENTS
        : DEFAULT_GEMINI_ASSIGNMENTS;

    this.assignments = { ...defaults };

    // Env var overrides. Form: MODEL_ROLE_ROUTER=gemini:gemini-2.5-pro
    const envOverrides: Array<[ModelRole, string | undefined]> = [
      ["router", process.env.MODEL_ROLE_ROUTER],
      ["specialist", process.env.MODEL_ROLE_SPECIALIST],
      ["synthesizer", process.env.MODEL_ROLE_SYNTHESIZER],
      ["judge", process.env.MODEL_ROLE_JUDGE],
      ["user-sim", process.env.MODEL_ROLE_USER_SIM],
      ["tier-fast", process.env.MODEL_ROLE_TIER_FAST],
      ["tier-mid", process.env.MODEL_ROLE_TIER_MID],
      ["tier-deep", process.env.MODEL_ROLE_TIER_DEEP]
    ];
    for (const [role, value] of envOverrides) {
      const parsed = parseAssignment(value);
      if (parsed) this.assignments[role] = parsed;
    }

    if (config.overrides) {
      for (const [role, assignment] of Object.entries(config.overrides) as Array<
        [ModelRole, ModelAssignment]
      >) {
        this.assignments[role] = assignment;
      }
    }
  }

  /** Look up the provider for a given role. */
  get(role: ModelRole): LlmProvider {
    const assignment = this.assignments[role];
    const primary = this.instantiate(role, assignment);

    if (!this.enableFailover || this.scriptedOverride) {
      return primary;
    }

    // Build a backup from the other family using the same-role default.
    const backupAssignment = this.backupAssignmentFor(assignment);
    if (!backupAssignment) return primary;
    const backupRole = role; // same role, different family
    const backup = this.instantiate(backupRole, backupAssignment);

    const failoverKey = `failover:${primary.name}|${backup.name}`;
    if (!this.cache.has(failoverKey)) {
      this.cache.set(
        failoverKey,
        new FailoverProvider({
          primary,
          backups: [backup]
        })
      );
    }
    return this.cache.get(failoverKey)!;
  }

  /** Find the "other family" default for the same role. */
  private backupAssignmentFor(primary: ModelAssignment): ModelAssignment | null {
    if (primary.family === "gemini" && this.env.openAiApiKey) {
      // Find the OpenAI default for whatever role this is.
      for (const [role, defaultAssignment] of Object.entries(
        DEFAULT_GEMINI_ASSIGNMENTS
      ) as Array<[ModelRole, ModelAssignment]>) {
        if (defaultAssignment.model === primary.model) {
          return DEFAULT_OPENAI_ASSIGNMENTS[role];
        }
      }
      return DEFAULT_OPENAI_ASSIGNMENTS.specialist;
    }
    if (primary.family === "openai" && this.env.geminiApiKey) {
      for (const [role, defaultAssignment] of Object.entries(
        DEFAULT_OPENAI_ASSIGNMENTS
      ) as Array<[ModelRole, ModelAssignment]>) {
        if (defaultAssignment.model === primary.model) {
          return DEFAULT_GEMINI_ASSIGNMENTS[role];
        }
      }
      return DEFAULT_GEMINI_ASSIGNMENTS.specialist;
    }
    return null;
  }

  /** Introspection: what's the current assignment for each role? */
  describe(): Record<ModelRole, ModelAssignment> {
    return { ...this.assignments };
  }

  private instantiate(role: ModelRole, assignment: ModelAssignment): LlmProvider {
    if (this.scriptedOverride) {
      // Every role gets the same scripted provider - the scripted config
      // is expected to handle whatever comes. Cache per-role so we can
      // inspect calls separately.
      const key = `scripted:${role}`;
      if (!this.cache.has(key)) {
        this.cache.set(
          key,
          new ScriptedProvider({
            ...this.scriptedOverride,
            name: `scripted:${role}`,
            model: this.scriptedOverride.model ?? role
          })
        );
      }
      return this.cache.get(key)!;
    }

    const cacheKey = `${assignment.family}:${assignment.model}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

    let provider: LlmProvider;
    if (assignment.family === "gemini") {
      if (!this.env.geminiApiKey) {
        // Contract: LlmProvider never throws from construction. Return a
        // provider that reports the missing-key error through the standard
        // LlmResponse.error path so callers don't need try/catch.
        provider = new ScriptedProvider({
          name: `missing-key:gemini:${assignment.model}`,
          model: assignment.model,
          handler: async () => ({
            error:
              `Gemini API key is not configured (required for role "${role}"). ` +
              `Set GEMINI_API_KEY in .env.`
          })
        });
      } else {
        provider = new GeminiProvider({
          apiKey: this.env.geminiApiKey,
          model: assignment.model
        });
      }
    } else if (assignment.family === "openai") {
      if (!this.env.openAiApiKey) {
        provider = new ScriptedProvider({
          name: `missing-key:openai:${assignment.model}`,
          model: assignment.model,
          handler: async () => ({
            error:
              `OpenAI API key is not configured (required for role "${role}"). ` +
              `Set OPENAI_API_KEY in .env.`
          })
        });
      } else {
        provider = new OpenAIProvider({
          apiKey: this.env.openAiApiKey,
          model: assignment.model
        });
      }
    } else if (assignment.family === "scripted") {
      provider = new ScriptedProvider({
        responses: [{ text: "{}" }],
        onExhausted: "default-answer"
      });
    } else {
      provider = new ScriptedProvider({
        handler: async () => ({
          error: `ModelPool: unknown family "${assignment.family}" for role "${role}"`
        })
      });
    }
    this.cache.set(cacheKey, provider);
    return provider;
  }
}

function parseAssignment(value: string | undefined): ModelAssignment | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const [family, ...modelParts] = trimmed.split(":");
  const model = modelParts.join(":");
  if (!family || !model) return null;
  if (family !== "gemini" && family !== "openai" && family !== "scripted") {
    return null;
  }
  return { family: family as ProviderFamily, model };
}

/**
 * Convenience: build a pool from the current environment with no overrides.
 * Most callers should use this.
 */
export function buildModelPool(config?: ModelPoolConfig): ModelPool {
  return new ModelPool(config);
}

/**
 * Map a tier name to its ModelRole key. Used by the router → specialist
 * dispatch path.
 */
export function roleForTier(tier: "fast" | "mid" | "deep"): ModelRole {
  return tier === "fast" ? "tier-fast" : tier === "deep" ? "tier-deep" : "tier-mid";
}
