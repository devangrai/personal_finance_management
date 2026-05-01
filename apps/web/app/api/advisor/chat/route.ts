import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { NextResponse } from "next/server";
import { z } from "zod";
import { advisorSystemIntent } from "@portfolio/ai";
import { getAdvisorPlanSnapshot } from "@/lib/advisor-plan";
import { getCashflowSummary } from "@/lib/cashflow-summary";
import { getAppEnv } from "@/lib/env";
import { getInvestmentsSummary } from "@/lib/investments";
import { getRecurringSummary } from "@/lib/recurring-summary";

const requestSchema = z.object({
  message: z.string().trim().min(1).max(800),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(1000)
      })
    )
    .max(8)
    .optional()
});

const responseSchema = z.object({
  answer: z.string(),
  bullets: z.array(z.string()).max(4),
  caveat: z.string().nullable(),
  followUps: z.array(z.string()).max(4)
});

type AdvisorChatResponse = z.infer<typeof responseSchema>;

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Advisor chat failed.";
}

function buildContextSummary(input: {
  advisorPlan: Awaited<ReturnType<typeof getAdvisorPlanSnapshot>>;
  cashflowSummary: Awaited<ReturnType<typeof getCashflowSummary>>;
  investmentsSummary: Awaited<ReturnType<typeof getInvestmentsSummary>>;
  recurringSummary: Awaited<ReturnType<typeof getRecurringSummary>>;
}) {
  return {
    facts: input.advisorPlan.facts,
    emergencyFund: input.advisorPlan.emergencyFund,
    retirement: input.advisorPlan.retirement,
    paycheckFlow: {
      takeHomeBaselineBiweekly:
        input.advisorPlan.paycheckFlow.takeHomeBaselineBiweekly,
      currentBiweeklyRetirementContribution:
        input.advisorPlan.paycheckFlow.currentBiweeklyRetirementContribution,
      currentBiweeklyTraditional401kContribution:
        input.advisorPlan.paycheckFlow.currentBiweeklyTraditional401kContribution,
      currentBiweeklyRoth401kContribution:
        input.advisorPlan.paycheckFlow.currentBiweeklyRoth401kContribution,
      currentBiweeklyTaxableBrokerageDeposit:
        input.advisorPlan.paycheckFlow.currentBiweeklyTaxableBrokerageDeposit,
      currentBiweeklyHsaEmployeeContribution:
        input.advisorPlan.paycheckFlow.currentBiweeklyHsaEmployeeContribution,
      currentBiweeklyHsaEmployerContribution:
        input.advisorPlan.paycheckFlow.currentBiweeklyHsaEmployerContribution,
      percentOfTakeHomeToRetirement:
        input.advisorPlan.paycheckFlow.percentOfTakeHomeToRetirement,
      recentPayPeriods: input.advisorPlan.paycheckFlow.recentPayPeriods.slice(0, 4),
      notes: input.advisorPlan.paycheckFlow.notes
    },
    paycheckAllocation: {
      availableBiweeklySurplus:
        input.advisorPlan.paycheckAllocation.availableBiweeklySurplus,
      scenarios: input.advisorPlan.paycheckAllocation.scenarios
    },
    latestCashMonth: input.cashflowSummary.latestMonth,
    recurring: {
      inflows: input.recurringSummary.inflows.slice(0, 4),
      outflows: input.recurringSummary.outflows.slice(0, 6)
    },
    investments: {
      totals: input.investmentsSummary.totals,
      accounts: input.investmentsSummary.accounts.slice(0, 8),
      recentTransactions: input.investmentsSummary.recentTransactions.slice(0, 12)
    }
  };
}

function buildDeterministicFallback(input: {
  message: string;
  advisorPlan: Awaited<ReturnType<typeof getAdvisorPlanSnapshot>>;
}): AdvisorChatResponse {
  const lower = input.message.toLowerCase();
  const { advisorPlan } = input;
  const retirement = advisorPlan.retirement;
  const paycheckFlow = advisorPlan.paycheckFlow;
  const facts = advisorPlan.facts;

  if (lower.includes("too much") || lower.includes("aggressive")) {
    return {
      answer:
        retirement.status === "aggressive"
          ? "Your current retirement pace looks aggressive relative to the current modeled target."
          : "The current data does not show you as obviously over-saving, but the answer is still limited by the missing payroll context.",
      bullets: [
        `Observed retirement flow is ${paycheckFlow.currentBiweeklyRetirementContribution} per pay cycle.`,
        paycheckFlow.percentOfTakeHomeToRetirement
          ? `That is about ${paycheckFlow.percentOfTakeHomeToRetirement}% of the observed take-home baseline.`
          : "The app does not yet have a stable take-home baseline for a cleaner percentage read.",
        "Pre-tax and Roth 401(k) activity is coming from the imported Fidelity transactions."
      ],
      caveat:
        facts.biweeklyNetPay == null
          ? "Add biweekly net pay to strengthen the recommendation."
          : "This is still based on cash-flow and Fidelity activity, not full payroll-stub detail.",
      followUps: [
        "What should I set as my biweekly net pay?",
        "How should I split my next paycheck?",
        "How much is going to brokerage versus retirement?"
      ]
    };
  }

  if (lower.includes("next paycheck") || lower.includes("split")) {
    const balancedScenario = advisorPlan.paycheckAllocation.scenarios.find(
      (scenario) => scenario.key === "balanced"
    );
    return {
      answer:
        "The balanced scenario is the cleanest default until we have stronger payroll inputs.",
      bullets: balancedScenario
        ? [
            `Retirement: ${balancedScenario.biweeklyAmounts.retirement}`,
            `Taxable investing: ${balancedScenario.biweeklyAmounts.taxableInvesting}`,
            `Reserve: ${balancedScenario.biweeklyAmounts.reserve}`,
            ...balancedScenario.reasoning.slice(0, 1)
          ]
        : ["Balanced allocation is unavailable right now."],
      caveat:
        facts.biweeklyNetPay == null
          ? "These figures are using observed free cash flow as a fallback because biweekly net pay is missing."
          : null,
      followUps: [
        "Should I be saving more into Roth 401(k) or brokerage?",
        "What changes if I enter my actual net pay?",
        "How close am I to my emergency-fund target?"
      ]
    };
  }

  return {
    answer:
      "I can already reason over your observed paycheck flow, Fidelity imports, and saved profile, but the strongest recommendations still depend on your real net-pay input and a cleaner reviewed ledger.",
    bullets: [
      `Observed retirement flow: ${paycheckFlow.currentBiweeklyRetirementContribution} per pay cycle.`,
      `Recurring brokerage deposit: ${paycheckFlow.currentBiweeklyTaxableBrokerageDeposit}.`,
      `Emergency-fund runway: ${advisorPlan.emergencyFund.runwayMonths} months.`,
      `Average monthly free cash flow basis: ${facts.averageMonthlyFreeCashflow}.`
    ],
    caveat:
      facts.biweeklyNetPay == null
        ? "Add biweekly net pay so I can move from rough guidance to a sharper paycheck-level recommendation."
        : "Some advice remains a cash-flow estimate until holdings snapshots are imported too.",
    followUps: [
      "Am I saving too aggressively for retirement right now?",
      "How should I split the next paycheck?",
      "What in my money flow still needs review?"
    ]
  };
}

async function generateWithOpenAi(input: {
  apiKey: string;
  model: string;
  context: ReturnType<typeof buildContextSummary>;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  const client = new OpenAI({
    apiKey: input.apiKey
  });

  const response = await client.responses.parse({
    model: input.model,
    input: [
      {
        role: "system",
        content:
          `${advisorSystemIntent}\n` +
          "You are a calm personal finance copilot. Answer briefly, directly, and only from the provided structured context. " +
          "Do not give legal or tax advice. Avoid pretending you know payroll facts that are missing."
      },
      {
        role: "system",
        content: `Structured context:\n${JSON.stringify(input.context, null, 2)}`
      },
      ...input.history.map((entry) => ({
        role: entry.role,
        content: entry.content
      })),
      {
        role: "user",
        content: input.message
      }
    ],
    text: {
      format: zodTextFormat(responseSchema, "advisor_chat_response")
    }
  });

  const parsed = response.output_parsed as AdvisorChatResponse | null;
  if (!parsed) {
    throw new Error("OpenAI did not return an advisor chat response.");
  }

  return parsed;
}

async function generateWithGemini(input: {
  apiKey: string;
  model: string;
  context: ReturnType<typeof buildContextSummary>;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      input.model
    )}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [
            {
              text:
                `${advisorSystemIntent}\n` +
                "You are a calm personal finance copilot. Answer briefly, directly, and only from the provided structured context. " +
                "Do not give legal or tax advice. Avoid pretending you know payroll facts that are missing."
            }
          ]
        },
        contents: [
          {
            parts: [
              {
                text:
                  `Structured context:\n${JSON.stringify(input.context, null, 2)}\n\n` +
                  `Recent chat history:\n${JSON.stringify(input.history, null, 2)}\n\n` +
                  `User message:\n${input.message}`
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object",
            properties: {
              answer: { type: "string" },
              bullets: {
                type: "array",
                items: { type: "string" }
              },
              caveat: {
                type: ["string", "null"]
              },
              followUps: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["answer", "bullets", "caveat", "followUps"],
            additionalProperties: false
          }
        }
      })
    }
  );

  const payload = (await response.json()) as GeminiGenerateContentResponse;
  if (!response.ok) {
    throw new Error(
      payload.error?.message ??
        `Gemini request failed with status ${response.status}.`
    );
  }

  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini did not return an advisor chat response.");
  }

  return responseSchema.parse(JSON.parse(text));
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const [advisorPlan, cashflowSummary, investmentsSummary, recurringSummary] =
      await Promise.all([
        getAdvisorPlanSnapshot(),
        getCashflowSummary(6),
        getInvestmentsSummary(),
        getRecurringSummary()
      ]);

    const context = buildContextSummary({
      advisorPlan,
      cashflowSummary,
      investmentsSummary,
      recurringSummary
    });
    const env = getAppEnv();

    let reply: AdvisorChatResponse | null = null;
    let provider = "deterministic";

    if (env.openAiApiKey) {
      try {
        reply = await generateWithOpenAi({
          apiKey: env.openAiApiKey,
          model: env.openAiModel,
          context,
          message: body.message,
          history: body.history ?? []
        });
        provider = `openai:${env.openAiModel}`;
      } catch {
        reply = null;
      }
    }

    if (!reply && env.geminiApiKey) {
      try {
        reply = await generateWithGemini({
          apiKey: env.geminiApiKey,
          model: env.geminiModel,
          context,
          message: body.message,
          history: body.history ?? []
        });
        provider = `gemini:${env.geminiModel}`;
      } catch {
        reply = null;
      }
    }

    if (!reply) {
      reply = buildDeterministicFallback({
        message: body.message,
        advisorPlan
      });
    }

    return NextResponse.json({
      ...reply,
      provider
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error)
      },
      {
        status: 400
      }
    );
  }
}
