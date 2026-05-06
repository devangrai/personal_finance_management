# LLM Provider Configuration

The advisor stack talks to LLMs through a single `LlmProvider` interface
(see `apps/web/lib/llm/types.ts`). Different *roles* in the system can use
different provider/model combos, and we ship role-based defaults with
automatic cross-family failover when multiple keys are configured.

## Quick start

**Gemini only** (what the project defaults to when only `GEMINI_API_KEY` is set):

```
GEMINI_API_KEY="..."
# Defaults: router=flash-lite, specialist=flash, synth=flash, deep=pro
```

**OpenAI only**:

```
OPENAI_API_KEY="..."
# Defaults: router=gpt-4.1-nano, specialist=gpt-4.1-mini, deep=gpt-4.1
```

**Both** (recommended when you want cross-family failover):

```
GEMINI_API_KEY="..."
OPENAI_API_KEY="..."
```

With both keys, `ModelPool.get()` wraps each role in a `FailoverProvider`
whose primary is the role's assigned provider and whose backup is the
equivalent role from the *other* family. If the primary's recent failure
rate exceeds a threshold (default 2 of last 5 calls), calls fall through
to the backup automatically.

## Per-role overrides

Each model role can be overridden via environment variable. The value
format is `<family>:<model>`:

| Role | Env var | Default (Gemini) | Default (OpenAI) |
|---|---|---|---|
| router | `MODEL_ROLE_ROUTER` | `gemini-2.5-flash-lite` | `gpt-4.1-nano` |
| specialist | `MODEL_ROLE_SPECIALIST` | `gemini-2.5-flash` | `gpt-4.1-mini` |
| synthesizer | `MODEL_ROLE_SYNTHESIZER` | `gemini-2.5-flash` | `gpt-4.1-mini` |
| judge | `MODEL_ROLE_JUDGE` | `gemini-2.5-flash` | `gpt-4.1-mini` |
| user-sim | `MODEL_ROLE_USER_SIM` | `gemini-2.5-flash-lite` | `gpt-4.1-nano` |
| tier-fast | `MODEL_ROLE_TIER_FAST` | `gemini-2.5-flash-lite` | `gpt-4.1-nano` |
| tier-mid | `MODEL_ROLE_TIER_MID` | `gemini-2.5-flash` | `gpt-4.1-mini` |
| tier-deep | `MODEL_ROLE_TIER_DEEP` | `gemini-2.5-pro` | `gpt-4.1` |

**Example: router on OpenAI, specialists on Gemini**

```
GEMINI_API_KEY="..."
OPENAI_API_KEY="..."
MODEL_ROLE_ROUTER="openai:gpt-4.1-nano"
MODEL_ROLE_TIER_FAST="openai:gpt-4.1-nano"
# Everything else uses Gemini defaults.
```

**Example: deep tier uses Claude (when AnthropicProvider ships)**

```
ANTHROPIC_API_KEY="..."
MODEL_ROLE_TIER_DEEP="anthropic:claude-sonnet-4.5"
```

## Request-time overrides

The chat route accepts URL params to force a provider for a single turn
(useful for A/B testing):

```
POST /api/advisor/chat?mode=agent&forceProvider=openai
POST /api/advisor/chat?mode=agent&forceProvider=gemini
```

When `forceProvider` is set, failover is disabled for that turn — the
intent is "measure this provider specifically."

The eval v2 harness supports the same via `--provider`:

```
npx tsx apps/web/scripts/advisor-eval-v2.ts --provider gemini --trials 3
npx tsx apps/web/scripts/advisor-eval-v2.ts --provider openai --trials 3
```

## Model responsibilities (Sierra-style "constellation of models")

- **router** (cheap, fast): reads a single user message, outputs
  `{specialists, tier, reasoning}`. Expected round-trip ~500ms.
- **specialist** (mid-tier reasoning, tool-calling): runs the agent loop
  with a focused tool whitelist. Typical 2–6 tool calls + final answer.
- **synthesizer** (mid-tier, JSON-structured output): merges multiple
  specialist replies into one unified response. Only invoked when router
  picked 2+ specialists.
- **judge** (reasoning, low temp): grades transcripts against rubrics.
  Used by `/api/sim/judge` and the `--judge` eval flag.
- **user-sim** (cheap, higher temperature): plays a persona in LLM-user
  simulations.

## Troubleshooting

**`insufficient_quota` from OpenAI.** Agent mode continues to work — the
`FailoverProvider` detects the error and routes to the Gemini backup. If
you have only OpenAI configured and it's out of credits, the route
returns an error via the normal `LlmResponse.error` path (no throw).

**Provider name collisions across roles.** The pool caches per
`${family}:${model}` key so two roles using the same model share one
provider instance. That's intentional — reduces connection overhead.

**Cost tracking.** Per-turn token totals land in
`RecommendationRun.outputPayload.totals`. Use `GET /api/advisor/stats` to
aggregate across the recent window.
