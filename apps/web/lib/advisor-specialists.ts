import { runAdvisorAgent, type AgentRunResult } from "./advisor-agent";
import { ALL_TOOLS } from "./advisor-tools";
import { getRelevantLessons, noteLessonApplied } from "./advisor-lessons";
import { getProfileSnapshot } from "./advisor-extractor";

/**
 * Specialist architecture.
 *
 * Each specialist is a configuration that parameterizes the *same* agent
 * loop (runAdvisorAgent). We do not spawn separate agent processes or
 * services; we specialize by:
 *   - narrowing the tool whitelist (fewer, more relevant tools)
 *   - replacing the system prompt with a domain-focused one
 *   - tagging audit logs with the specialist name for per-domain eval
 *
 * A deterministic router classifies the user's message into 1..N domains.
 * If N=1, that specialist handles it alone. If N>1, specialists run in
 * parallel and a synthesizer LLM call merges their outputs.
 *
 * The "general-advisor" specialist is the catch-all: full tool access,
 * general system prompt. It exists both as a fallback and as the
 * single-specialist baseline from Week 1.
 */

export type SpecialistName =
  | "spending-coach"
  | "goal-tracker"
  | "portfolio-analyst"
  | "tax-planner"
  | "retirement-pacer"
  | "general-advisor";

export type SpecialistConfig = {
  name: SpecialistName;
  label: string;
  systemPrompt: string;
  /** Tools this specialist can invoke; undefined = full surface. */
  toolWhitelist?: string[];
  /** Keywords and phrases that suggest this specialist should handle a message. */
  routingPatterns: RegExp[];
  /** LessonTopic the specialist should pull graduated lessons for on each turn. */
  lessonTopic: "tax" | "retirement" | "spending" | "portfolio" | "goals" | "general";
};

const FINAL_RESPONSE_INSTRUCTIONS = `
When you have enough information to answer, respond with a single plain-text JSON object matching this shape:
{
  "answer": "the concise answer (1-3 sentences)",
  "bullets": ["optional supporting bullet", "up to 4 entries"],
  "caveat": "optional single sentence caveat, or null",
  "followUps": ["optional follow-up question 1", "up to 4"]
}
Do not wrap the JSON in code fences. Do not add commentary around it. Return ONLY the JSON object.
`.trim();

const SHARED_GUARDRAILS = `
Ground every number you quote in a tool result. Do NOT fabricate balances, rates, or limits. If tools have not given you a number, say you do not have it rather than guess.

YOU ARE NOT a disclaimer bot. You are an opinionated advisor for your
user's money. Give concrete, quantified recommendations backed by the
user's actual data. "I can't give financial advice" is a failure mode —
the user hired you to give exactly that. When asked to assess, rebalance,
or advise on their portfolio, cash flow, retirement pace, or debt
payoff, take a position and back it with numbers.

WHAT YOU DO: portfolio allocation guidance (including "shift X% from
growth to bonds" if the user's risk profile supports it), rebalancing
suggestions, cash-flow and savings-rate recommendations, retirement
pacing math, emergency-fund sizing, debt-payoff order, tax-advantaged
account contribution guidance, category-level spending feedback.

WHAT YOU DON'T DO:
- Individual equity picks ("buy AAPL"). You can discuss allocation to
  broad asset classes (US equities, international, bonds, cash) but not
  single-name stock selection.
- Market timing or predictions of future returns.
- Prescriptive tax-filing advice (e.g. "file as head of household",
  "claim this deduction") — point the user to a CPA for filing decisions.
  Tax *observations* are fine ("you're within the Roth IRA phase-out
  range for 2026 as a single filer").
- Moving money, placing trades, or otherwise taking action on the user's
  behalf.

When data has obvious inconsistencies (e.g. two sources disagreeing on a
balance), flag the inconsistency briefly, then proceed with your best
read instead of refusing to answer. Make assumptions explicit: "assuming
your $138k retirement balance is correct..."

LESSON-GRADUATION PROTOCOL:
  If the user makes an *unambiguous* confirmation of a pattern you've observed — e.g. "yes, exactly, remember that", "right, apply this going forward", "that's correct, save this as a rule" — call list_pending_candidate_lessons to find matching candidates, then call graduate_candidate_lesson with the relevant id and a rationale quoting what the user said.
  Do NOT graduate based on weak signals like polite agreement, "sure", "ok", "thanks", or anything ambiguous. When in doubt, don't graduate. Confirm verbally in your final answer instead and let the user opt in explicitly next turn.
  Do NOT invent lessons. The candidate must already exist in the list returned by list_pending_candidate_lessons.
`.trim();

// ---------------------------------------------------------------------------
// Specialist configurations
// ---------------------------------------------------------------------------

const spendingCoach: SpecialistConfig = {
  name: "spending-coach",
  label: "Spending Coach",
  systemPrompt: `
You are the user's spending coach. Your job is to help the user see their own spending patterns clearly, identify trends that may be worth correcting, and celebrate improvements.

Voice: warm, honest, behavioral. You observe without judging; you ask good questions; you push back kindly when the data warrants it. Prefer "you spent X on Y" over "you should have spent less on Y."

Typical tools you will reach for:
  - get_cashflow_summary for multi-month context
  - get_spending_by_category for a specific month
  - get_spending_trend for direction-over-time
  - search_transactions for merchant-level drill-downs
  - get_recurring for subscription and recurring-bill questions
  - get_goals and get_user_facts to respect prior context
  - save_user_fact or save_user_goal when the user volunteers a budget commitment

${SHARED_GUARDRAILS}

${FINAL_RESPONSE_INSTRUCTIONS}
`.trim(),
  toolWhitelist: [
    "get_cashflow_summary",
    "get_spending_by_category",
    "get_spending_trend",
    "search_transactions",
    "get_recurring",
    "get_goals",
    "get_user_facts",
    "save_user_fact",
    "save_user_goal",
    "get_budget_status",
    "update_budget",
    "get_user_lessons",
    "list_pending_candidate_lessons",
    "graduate_candidate_lesson"
  ],
  routingPatterns: [
    /\b(spend|spending|spent|expense|expenses|spend(ing)?\s+trend|over[- ]?spending|budget|budgeting)\b/i,
    /\b(dining|groceries|grocery|restaurants?|subscriptions?|subscription|subscriptions|transportation|shopping|travel|entertainment|utilities|bills?)\b/i,
    /\b(trend|up|down|more|less|higher|lower|change)\b.*\b(spending|cost|bill|expense)/i,
    /\b(cut back|cut down|reduce|save money|overspend|overpaying)\b/i,
    /\b(how much .* (spend|cost|paid|charge))/i
  ],
  lessonTopic: "spending"
};

const goalTracker: SpecialistConfig = {
  name: "goal-tracker",
  label: "Goal Tracker",
  systemPrompt: `
You are the user's goal tracker. Your job is to capture goals the user commits to, grade progress against them over time, and hold the user accountable to their own stated intentions.

Voice: coachy, accountability-oriented. When the user states a goal, save it via save_user_goal so it is remembered across sessions. When asked about progress, always call get_goals + get_goal_progress first.

Typical tools you will reach for:
  - get_goals, get_goal_progress (primary)
  - save_user_goal, deactivate_goal (when the user commits or abandons)
  - get_user_facts, save_user_fact (for context like age, target retirement age)
  - get_advisor_plan, get_paycheck_flow via get_advisor_plan, get_investments_summary for grounding
  - search_transactions if a goal is about spending behavior

${SHARED_GUARDRAILS}

${FINAL_RESPONSE_INSTRUCTIONS}
`.trim(),
  toolWhitelist: [
    "get_goals",
    "get_goal_progress",
    "save_user_goal",
    "deactivate_goal",
    "get_user_facts",
    "save_user_fact",
    "get_advisor_plan",
    "get_investments_summary",
    "search_transactions",
    "search_documents",
    "get_user_lessons",
    "list_pending_candidate_lessons",
    "graduate_candidate_lesson"
  ],
  routingPatterns: [
    /\b(goal|goals|target|committed|commitment|commit|pacing|on\s+track|ahead|behind|progress)\b/i,
    /\b(i\s+(want\s+to|would\s+like\s+to|will|plan\s+to|intend\s+to))\b/i,
    /\b(by\s+(end\s+of|december|year[- ]end|next\s+year|\d{4}))/i,
    /\b(set\s+a\s+goal|track\s+(this|that|my))/i
  ],
  lessonTopic: "goals"
};

const portfolioAnalyst: SpecialistConfig = {
  name: "portfolio-analyst",
  label: "Portfolio Analyst",
  systemPrompt: `
You are the user's portfolio analyst. Your job is to analyze allocation, diversification, concentration risk, and account-level positioning — AND to give opinionated, quantified recommendations when asked.

Voice: quantitative, direct, precise with numbers. Always cite the source and as-of date when reporting a holdings figure.

WHEN THE USER ASKS FOR ADVICE (e.g. "grade my allocation", "should I
rebalance", "suggest moves"), take a position and back it with numbers:
  - Evaluate their current allocation against a reasonable target for
    their age and risk profile (if known from get_user_facts, use it;
    otherwise state the assumption).
  - Call out specific % shifts ("move ~15% from US equities to bonds")
    with the reasoning ("your bond allocation is 4%, a 60/40 profile
    would suggest 40%").
  - Flag concentration risk by security, sector, or account type.
  - Use get_age_based_retirement_target for benchmark context when
    evaluating overall pacing.

You discuss BROAD ASSET CLASSES (US equities, international, bonds, cash,
real estate, crypto). You do NOT pick individual stocks or predict
specific securities' returns. "Shift 10% to bonds" is fine; "buy AAPL"
is not.

Tax-loss harvesting, bond-for-tax-efficiency, account-location (bonds
in retirement, equities in taxable) are all fine to discuss as
OBSERVATIONS with caveats.

Typical tools you will reach for:
  - analyze_allocation (primary)
  - get_investments_summary for totals and recent activity
  - search_transactions (source=manual_investment) for investment activity drill-downs
  - get_user_facts for risk tolerance, retirement balance
  - get_age_based_retirement_target for benchmark anchoring
  - save_user_fact when the user volunteers risk tolerance or target allocation

${SHARED_GUARDRAILS}

${FINAL_RESPONSE_INSTRUCTIONS}
`.trim(),
  toolWhitelist: [
    "analyze_allocation",
    "get_investments_summary",
    "search_transactions",
    "search_documents",
    "get_user_facts",
    "save_user_fact",
    "get_age_based_retirement_target",
    "get_user_lessons",
    "list_pending_candidate_lessons",
    "graduate_candidate_lesson"
  ],
  routingPatterns: [
    /\b(portfolio|allocation|allocated|diversif|diversif\w+|concentration|concentrated|heavy|overweight|underweight|rebalance|rebalancing|asset[- ]?allocation)\b/i,
    /\b(retirement\s+balance|taxable\s+balance|brokerage\s+balance)\b/i,
    /\b(too\s+(much|little|heavy|concentrated)\s+(in|into)\b)/i,
    /\b(stocks?|bonds?|index\s+funds?|etf|holdings?)\b/i
  ],
  lessonTopic: "portfolio"
};

const taxPlanner: SpecialistConfig = {
  name: "tax-planner",
  label: "Tax Planner",
  systemPrompt: `
You are the user's tax planner. Your job is to surface tax-adjacent *observations*: contribution-limit status, phase-out positioning, year-end checkpoints, Roth vs. traditional mechanics.

HARD RULE: You do not give prescriptive tax advice. "You should file as single" is out of bounds. "Your income level places you above the Roth IRA contribution phase-out start for 2026 (single filer)" is fine. If the user asks for tax advice, point them to a professional and stay observational.

Voice: precise, explicit about tax year and jurisdiction. Always call get_irs_limits for any contribution or phase-out question.

Typical tools you will reach for:
  - get_irs_limits (primary)
  - get_advisor_plan for year-to-date flow
  - search_transactions (source=manual_investment) for contribution totals
  - get_user_facts (filing_status, age, income)
  - save_user_fact when the user volunteers tax-relevant context

${SHARED_GUARDRAILS}

${FINAL_RESPONSE_INSTRUCTIONS}
`.trim(),
  toolWhitelist: [
    "get_irs_limits",
    "get_advisor_plan",
    "search_transactions",
    "search_documents",
    "get_user_facts",
    "save_user_fact",
    "get_profile",
    "get_user_lessons",
    "list_pending_candidate_lessons",
    "graduate_candidate_lesson"
  ],
  routingPatterns: [
    // Tax-specific keywords only. Do NOT match plain "401k", "ira", "roth"
    // alone - those are shared with retirement-pacer. Require tax-flavored
    // context (limit, phaseout, contribution limit, tax year, filing).
    /\b(tax|taxes|taxable)\b/i,
    /\b(phase[- ]?out|deduction|deferral|contribution\s+limit|over[- ]?contribut|under[- ]?contribut)\b/i,
    /\b(filing\s+status|married|head\s+of\s+household|hoh|mfj|mfs)\b/i,
    /\b(irs|irs\s+limit|maximum\s+contribution|contribution\s+cap)\b/i,
    /\b(401k|401\(k\)|ira|roth).*\b(limit|cap|maximum|max|phase[- ]?out)\b/i,
    /\b(limit|cap|maximum|max|phase[- ]?out).*\b(401k|401\(k\)|ira|roth)\b/i
  ],
  lessonTopic: "tax"
};

const retirementPacer: SpecialistConfig = {
  name: "retirement-pacer",
  label: "Retirement Pacer",
  systemPrompt: `
You are the user's retirement pacer. Your job is to assess whether the user's current pace will get them to a reasonable retirement, using standard benchmarks (Fidelity wealth multiples, common 10-15% gross savings rate, age-based targets).

Voice: long-horizon, numbers-first, calm. Always anchor opinions to an industry benchmark AND to the user's own stated target age if one exists.

Typical tools you will reach for:
  - get_advisor_plan for observed paycheck flow and retirement status
  - get_age_based_retirement_target for the wealth-multiple benchmark
  - get_irs_limits for contribution room
  - get_user_facts (age, target_retirement_age, current_retirement_balance)
  - get_goals for prior retirement commitments
  - save_user_fact, save_user_goal when the user commits

${SHARED_GUARDRAILS}

${FINAL_RESPONSE_INSTRUCTIONS}
`.trim(),
  toolWhitelist: [
    "get_advisor_plan",
    "get_age_based_retirement_target",
    "get_irs_limits",
    "get_user_facts",
    "save_user_fact",
    "get_goals",
    "save_user_goal",
    "get_goal_progress",
    "get_investments_summary",
    "search_documents",
    "get_user_lessons",
    "list_pending_candidate_lessons",
    "graduate_candidate_lesson"
  ],
  routingPatterns: [
    // Retirement domain, broader coverage for multi-domain questions.
    // We rely on overlap-resolution in classifyDomains (below) to drop
    // retirement-pacer when the question is clearly a pure-tax limit query.
    /\b(retire|retiring|retirement)\b/i,
    /\b(401k|401\(k\)|403b|403\(b\)|roth\s+ira|ira|pension)\b/i,
    /\b(saving\s+enough|save\s+enough|on\s+track)\b/i,
    /\b(catch[- ]?up|catchup)\b/i,
    /\b(contribute\s+more|increase\s+contribution|contribution\s+rate|savings\s+rate)\b/i,
    /\b(wealth\s+multiple|years\s+until\s+retirement|retirement\s+age|target\s+retirement\s+age)\b/i
  ],
  lessonTopic: "retirement"
};

const generalAdvisor: SpecialistConfig = {
  name: "general-advisor",
  label: "General Advisor",
  systemPrompt: `
You are the user's general financial advisor. Handle questions that span multiple domains or do not fit a specialist cleanly. Integrate across spending, goals, portfolio, tax, and retirement context.

Voice: integrative, connects dots across domains. When the question has a clear single-domain emphasis, say so and note which specialist would otherwise handle it.

You have access to the full tool surface. Be disciplined - do not call tools beyond what this specific question needs.

${SHARED_GUARDRAILS}

${FINAL_RESPONSE_INSTRUCTIONS}
`.trim(),
  // No toolWhitelist = full surface
  routingPatterns: [
    /\b(overall|everything|how\s+am\s+i\s+doing|financial\s+picture|holistic|in\s+general)\b/i,
    /\b(should\s+i)\b/i
  ],
  lessonTopic: "general"
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SPECIALISTS: Record<SpecialistName, SpecialistConfig> = {
  "spending-coach": spendingCoach,
  "goal-tracker": goalTracker,
  "portfolio-analyst": portfolioAnalyst,
  "tax-planner": taxPlanner,
  "retirement-pacer": retirementPacer,
  "general-advisor": generalAdvisor
};

// ---------------------------------------------------------------------------
// Deterministic router
// ---------------------------------------------------------------------------

export type RouterClassification = {
  domains: SpecialistName[];
  matchedPatterns: Array<{ specialist: SpecialistName; pattern: string }>;
  fallback: "none" | "general-advisor";
};

export function classifyDomains(message: string): RouterClassification {
  const matchedPatterns: RouterClassification["matchedPatterns"] = [];
  const matchedSpecialists = new Set<SpecialistName>();

  // Check each specialist's patterns except general-advisor which is the
  // fallback.
  for (const config of [
    spendingCoach,
    goalTracker,
    portfolioAnalyst,
    taxPlanner,
    retirementPacer
  ]) {
    for (const pattern of config.routingPatterns) {
      if (pattern.test(message)) {
        matchedSpecialists.add(config.name);
        matchedPatterns.push({
          specialist: config.name,
          pattern: pattern.source
        });
        break; // one match per specialist is enough to classify
      }
    }
  }

  // --- Overlap resolution rules --------------------------------------------
  // These rules encode domain priority when two specialists fire for what
  // should really be a single-domain question. Each rule is additive and
  // explainable.

  // Rule 1: pure-tax "limit/phase-out/cap/IRS" questions should not
  // additionally pull retirement-pacer, even when the message mentions 401k
  // or IRA (because the user is asking *about the tax rules*, not *about
  // pacing*). Keep retirement-pacer when the message also mentions pacing
  // words (pace, on track, saving enough, retirement age, catchup).
  if (
    matchedSpecialists.has("tax-planner") &&
    matchedSpecialists.has("retirement-pacer")
  ) {
    const pureTaxSignal =
      /\b(limit|cap|maximum|phase[- ]?out|irs|contribute\s+too\s+much)\b/i.test(
        message
      );
    const pacingSignal =
      /\b(pace|pacing|on\s+track|saving\s+enough|save\s+enough|catch[- ]?up|catchup|retirement\s+age|target\s+retirement|aggressive\s+enough|allocation|concentrat|overweight|too\s+much|too\s+aggressive|too\s+little)\b/i.test(
        message
      );
    if (pureTaxSignal && !pacingSignal) {
      matchedSpecialists.delete("retirement-pacer");
    }
  }

  // Rule 2: portfolio allocation/concentration questions should not pull
  // retirement-pacer just because "retirement" is mentioned as a BUCKET
  // LABEL (e.g. "how is my portfolio allocated between retirement and
  // taxable"). Heuristic: if the question has explicit portfolio words
  // (allocated, allocation, concentrated, concentration, retirement AND
  // taxable together as buckets) and does NOT mention pacing words, drop
  // retirement-pacer.
  if (
    matchedSpecialists.has("portfolio-analyst") &&
    matchedSpecialists.has("retirement-pacer")
  ) {
    const bucketLabelPattern =
      /\b(retirement\s+and\s+taxable|taxable\s+and\s+retirement|retirement\s+vs\.?\s+taxable|between\s+retirement\s+and\s+taxable)\b/i;
    const pureAllocationSignal =
      /\b(allocat|diversif|concentrat|overweight|underweight|rebalance|holding|holdings|single\s+holding)\b/i.test(
        message
      );
    const pacingSignal =
      /\b(pace|pacing|on\s+track|saving\s+enough|aggressive\s+enough|age\s+appropriate|appropriate\s+for\s+my\s+age)\b/i.test(
        message
      );
    if (
      (bucketLabelPattern.test(message) || pureAllocationSignal) &&
      !pacingSignal
    ) {
      matchedSpecialists.delete("retirement-pacer");
    }
  }

  // Rule 3: portfolio-analyst + tax-planner collision. If "filing status"
  // or explicit filing words appear, keep tax-planner. Otherwise, if the
  // only tax signal is a word like "single" that got reused in
  // allocation/portfolio wording (we already mitigated this by removing
  // bare "single" from tax-planner, but guard anyway), drop tax-planner.
  if (
    matchedSpecialists.has("portfolio-analyst") &&
    matchedSpecialists.has("tax-planner")
  ) {
    const genuineTaxSignal =
      /\b(tax|taxes|filing\s+status|phase[- ]?out|deduction|deferral|contribution\s+limit|irs)\b/i.test(
        message
      );
    if (!genuineTaxSignal) {
      matchedSpecialists.delete("tax-planner");
    }
  }

  const domains = [...matchedSpecialists];
  if (domains.length === 0) {
    return {
      domains: ["general-advisor"],
      matchedPatterns,
      fallback: "general-advisor"
    };
  }

  return { domains, matchedPatterns, fallback: "none" };
}

// ---------------------------------------------------------------------------
// Dispatcher: run one specialist, or multiple in parallel
// ---------------------------------------------------------------------------

export async function runSpecialist(input: {
  specialist: SpecialistName;
  provider: import("./llm/types").LlmProvider;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  /**
   * Freeform "about me" prose the user wrote on the Context tab. Goes at
   * the very top of the specialist primer so it frames everything else.
   */
  personalContext?: string | null;
  /**
   * User id, needed so the specialist's primer can include the user's
   * known facts + active goals. Optional for backward-compat with tests
   * that don't wire a user — in that case, facts/goals primers are empty.
   */
  userId?: string;
}): Promise<
  AgentRunResult & {
    specialist: SpecialistName;
    appliedLessons: Array<{
      id: string;
      topic: string;
      kind: string;
      actionOrCaveat: string;
    }>;
  }
> {
  const config = SPECIALISTS[input.specialist];

  // Week 5: pull graduated lessons for this specialist's topic and inject
  // them into the primer so the specialist respects the user's preferences
  // and any prior advice lessons from the start of the turn.
  const lessons = await getRelevantLessons({
    topic: config.lessonTopic,
    limit: 6
  });
  const lessonsPrimer =
    lessons.length > 0
      ? `\n\nGRADUATED LESSONS FOR THIS USER (apply these without re-litigating):\n${lessons
          .map((l, i) => `  ${i + 1}. [${l.kind}] ${l.actionOrCaveat}`)
          .join("\n")}\n`
      : "";

  // Record that we surfaced these lessons so we can tell which ones are
  // still useful. Best-effort; non-fatal.
  for (const lesson of lessons) {
    void noteLessonApplied(lesson.id);
  }

  const personalContextClean = (input.personalContext ?? "").trim();
  const personalContextPrimer =
    personalContextClean.length > 0
      ? `\n\nABOUT THE USER (self-reported context — always consider):\n${personalContextClean}\n`
      : "";

  // Week 6: inject the top user facts + active goals so the specialist
  // already knows these things and doesn't waste tool calls asking.
  // Kept small: top 15 facts + 10 goals.
  const profileSnapshot = input.userId
    ? await getProfileSnapshot(input.userId)
    : {
        facts: [] as Array<{
          factKey: string;
          factValue: unknown;
          source: string;
          sourceDocumentTitle?: string | null;
        }>,
        activeGoals: [] as Array<{
          goalKey: string;
          label: string;
          targetValue: string | null;
          targetDate: string | null;
        }>
      };
  const factsPrimer =
    profileSnapshot.facts.length > 0
      ? `\n\nKNOWN FACTS ABOUT THIS USER (auto-applied or confirmed — use these, don't re-ask):\n${profileSnapshot.facts
          .slice(0, 15)
          .map((f, i) => {
            const value =
              typeof f.factValue === "object"
                ? JSON.stringify(f.factValue)
                : String(f.factValue);
            const provenance = f.sourceDocumentTitle
              ? ` (source: ${f.sourceDocumentTitle})`
              : "";
            return `  ${i + 1}. ${f.factKey} = ${value}${provenance}`;
          })
          .join("\n")}\n`
      : "";
  const goalsPrimer =
    profileSnapshot.activeGoals.length > 0
      ? `\n\nACTIVE GOALS:\n${profileSnapshot.activeGoals
          .slice(0, 10)
          .map(
            (g, i) =>
              `  ${i + 1}. ${g.label} (${g.goalKey})${
                g.targetValue ? ` — target $${g.targetValue}` : ""
              }${g.targetDate ? ` by ${g.targetDate}` : ""}`
          )
          .join("\n")}\n`
      : "";

  const result = await runAdvisorAgent({
    provider: input.provider,
    message: input.message,
    history: input.history,
    toolWhitelist: config.toolWhitelist,
    systemPromptOverride:
      config.systemPrompt +
      personalContextPrimer +
      factsPrimer +
      goalsPrimer +
      lessonsPrimer,
    specialistLabel: config.name
  });
  return {
    ...result,
    specialist: input.specialist,
    appliedLessons: lessons.map((l) => ({
      id: l.id,
      topic: l.topic,
      kind: l.kind,
      actionOrCaveat: l.actionOrCaveat
    }))
  };
}

// ---------------------------------------------------------------------------
// Synthesizer (multi-domain path)
// ---------------------------------------------------------------------------

export type SynthesizerResult = {
  answer: string;
  bullets: string[];
  caveat: string | null;
  followUps: string[];
};

const SYNTHESIZER_SYSTEM = `
You are the coordinator for a panel of specialist financial advisors. You receive each specialist's final answer and produce a single unified reply to the user.

Rules:
- Speak in one voice, not "the spending coach said...". Integrate the specialists' findings.
- Preserve every number the specialists cited. Do not add or remove numbers.
- If specialists disagree or emphasize different aspects, surface the tradeoff honestly.
- Keep it concise: 1-3 sentence answer, up to 4 bullets, 0-1 caveat, up to 4 follow-up questions.
- followUps MUST be written from the user's point of view, as natural next
  things THE USER would say. Never write followUps as questions directed
  AT the user (like "What is the user's income?") — those break the UI
  which renders followUps as tappable quick-reply chips.

Respond ONLY with JSON in this shape (no code fences):
{
  "answer": "...",
  "bullets": ["..."],
  "caveat": "..." | null,
  "followUps": ["first-person next question the user might ask"]
}
`.trim();

export async function synthesizeSpecialistResponses(input: {
  provider: import("./llm/types").LlmProvider;
  userMessage: string;
  specialistResponses: Array<{
    specialist: SpecialistName;
    reply: SynthesizerResult | null;
    error: string | null;
  }>;
}): Promise<SynthesizerResult> {
  const validResponses = input.specialistResponses.filter(
    (r) => r.reply !== null
  );

  // If we only have one valid response, return it directly - no synth needed.
  if (validResponses.length === 1 && validResponses[0].reply) {
    return validResponses[0].reply;
  }

  // If all specialists failed, return a graceful default.
  if (validResponses.length === 0) {
    return {
      answer:
        "I was unable to produce a grounded answer right now. The specialists all failed to respond.",
      bullets: input.specialistResponses.map(
        (r) => `${r.specialist}: ${r.error ?? "no response"}`
      ),
      caveat:
        "Please retry; this usually resolves on the next attempt.",
      followUps: []
    };
  }

  const formatted = validResponses
    .map(
      (r) =>
        `### ${r.specialist}\n${r.reply ? JSON.stringify(r.reply, null, 2) : "(no reply)"}`
    )
    .join("\n\n");

  const prompt = `User question:\n${input.userMessage}\n\nSpecialist responses:\n${formatted}\n\nProduce the unified reply now.`;

  const response = await input.provider.generate({
    systemPrompt: SYNTHESIZER_SYSTEM,
    messages: [{ role: "user", content: prompt }],
    responseSchema: {
      type: "object",
      properties: {
        answer: { type: "string" },
        bullets: { type: "array", items: { type: "string" } },
        caveat: { type: ["string", "null"] },
        followUps: { type: "array", items: { type: "string" } }
      },
      required: ["answer", "bullets", "caveat", "followUps"],
      additionalProperties: false
    },
    temperature: 0.2,
    timeoutMs: 15_000
  });

  if (response.finishReason === "error" || response.finishReason === "timeout" || !response.text) {
    // Synth failed - fall back to the first specialist's answer.
    return validResponses[0].reply as SynthesizerResult;
  }

  try {
    const parsed = JSON.parse(response.text) as SynthesizerResult;
    return {
      answer: parsed.answer ?? "",
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, 4) : [],
      caveat: typeof parsed.caveat === "string" ? parsed.caveat : null,
      followUps: Array.isArray(parsed.followUps)
        ? parsed.followUps.slice(0, 4)
        : []
    };
  } catch {
    return validResponses[0].reply as SynthesizerResult;
  }
}

// ---------------------------------------------------------------------------
// Introspection helpers
// ---------------------------------------------------------------------------

export function getSpecialistToolCoverage() {
  return Object.fromEntries(
    (Object.entries(SPECIALISTS) as Array<[SpecialistName, SpecialistConfig]>).map(
      ([name, config]) => [
        name,
        {
          toolWhitelist: config.toolWhitelist ?? ALL_TOOLS.map((t) => t.name),
          toolCount: config.toolWhitelist?.length ?? ALL_TOOLS.length
        }
      ]
    )
  );
}
