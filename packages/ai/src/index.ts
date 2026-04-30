import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

export type AdvisorToolName =
  | "cashflow_summary"
  | "retirement_contribution"
  | "emergency_fund"
  | "portfolio_allocation"
  | "tax_bucket_summary";

export type AdvisorRequestContext = {
  userId: string;
  asOfDate: string;
  objective: string;
};

export type AdvisorRecommendation = {
  headline: string;
  rationale: string[];
  cautions: string[];
  followUps: string[];
};

export const advisorSystemIntent = `
Use only structured tool results and saved user profile context.
Do not fabricate account balances, contribution limits, tax facts, or investment performance.
Surface missing inputs explicitly before making a recommendation.
`;

export type CategorizationCategoryOption = {
  key: string;
  label: string;
  parentKey?: string | null;
};

export type TransactionCategorizationCandidate = {
  id: string;
  date: string;
  name: string;
  merchantName?: string | null;
  amount: string;
  direction: "debit" | "credit";
  accountName: string;
  accountType: string;
  accountSubtype?: string | null;
  institutionName?: string | null;
  personalFinanceCategory?: string | null;
};

export type CategorizationSuggestion = {
  transactionId: string;
  categoryKey: string;
  confidence: number;
  reason: string;
};

const categorizationResponseSchema = z.object({
  suggestions: z.array(
    z.object({
      transactionId: z.string(),
      categoryKey: z.string(),
      confidence: z.number().int().min(0).max(100),
      reason: z.string()
    })
  )
});

type CategorizationSchema = z.infer<typeof categorizationResponseSchema>;

type CategorizeTransactionsInput = {
  apiKey: string;
  model: string;
  categories: CategorizationCategoryOption[];
  transactions: TransactionCategorizationCandidate[];
  linkedInstitutionNames: string[];
  today: string;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

function buildSystemPrompt(categories: CategorizationCategoryOption[]) {
  return [
    "You categorize personal finance transactions into a small application taxonomy.",
    "Choose exactly one categoryKey from the provided list for every transaction.",
    "Be conservative. If the transaction is genuinely ambiguous, choose uncategorized with lower confidence.",
    "Treat transfers between the user's own linked institutions as transfer or investing, not income or spending.",
    "Treat credit card payments as transfer.",
    "Treat Zelle or peer reimbursements as transfer unless clear evidence shows salary or business income.",
    "Use paycheck only for payroll-like income. Use tax for tax payments. Use subscription for recurring SaaS or memberships.",
    "Keep reasons short and concrete."
  ].join(" ");
}

function buildUserPrompt(input: Omit<CategorizeTransactionsInput, "apiKey" | "model">) {
  return JSON.stringify(
    {
      today: input.today,
      linkedInstitutionNames: input.linkedInstitutionNames,
      categories: input.categories,
      transactions: input.transactions
    },
    null,
    2
  );
}

export async function categorizeTransactionsWithAi(
  input: CategorizeTransactionsInput
): Promise<CategorizationSuggestion[]> {
  const openai = new OpenAI({
    apiKey: input.apiKey
  });

  const response = await openai.responses.parse({
    model: input.model,
    input: [
      {
        role: "system",
        content: buildSystemPrompt(input.categories)
      },
      {
        role: "user",
        content: buildUserPrompt(input)
      }
    ],
    text: {
      format: zodTextFormat(categorizationResponseSchema, "categorization_suggestions")
    }
  });

  const parsed = response.output_parsed as CategorizationSchema | null;
  if (!parsed) {
    throw new Error("OpenAI did not return categorization suggestions.");
  }

  return parsed.suggestions;
}

export async function categorizeTransactionsWithGemini(
  input: CategorizeTransactionsInput
): Promise<CategorizationSuggestion[]> {
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
              text: buildSystemPrompt(input.categories)
            }
          ]
        },
        contents: [
          {
            parts: [
              {
                text: buildUserPrompt(input)
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object",
            properties: {
              suggestions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    transactionId: {
                      type: "string",
                      description: "Transaction id from the input row."
                    },
                    categoryKey: {
                      type: "string",
                      description: "One category key from the provided taxonomy."
                    },
                    confidence: {
                      type: "integer",
                      minimum: 0,
                      maximum: 100,
                      description:
                        "Confidence from 0 to 100 for the suggested category."
                    },
                    reason: {
                      type: "string",
                      description:
                        "Short concrete rationale for the category selection."
                    }
                  },
                  required: [
                    "transactionId",
                    "categoryKey",
                    "confidence",
                    "reason"
                  ],
                  additionalProperties: false
                }
              }
            },
            required: ["suggestions"],
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
    throw new Error("Gemini did not return categorization suggestions.");
  }

  const parsed = categorizationResponseSchema.parse(
    JSON.parse(text)
  ) as CategorizationSchema;
  return parsed.suggestions;
}
