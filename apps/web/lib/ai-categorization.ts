import {
  categorizeTransactionsWithAi,
  type CategorizationCategoryOption,
  type CategorizationSuggestion,
  type TransactionCategorizationCandidate
} from "@portfolio/ai";
import {
  prisma,
  TransactionReviewStatus
} from "@portfolio/db";
import { listCategories, getDefaultUserId } from "./categories";
import { getAppEnv } from "./env";

type AutoCategorizeTransactionsInput = {
  limit?: number;
  transactionIds?: string[];
  localDateKey?: string;
};

type AutoCategorizedTransaction = {
  id: string;
  name: string;
  merchantName: string | null;
  assignedCategoryKey: string | null;
  assignedCategoryLabel: string | null;
  confidence: number | null;
  reason: string | null;
  reviewStatus: string;
};

type AutoCategorizeTransactionsResult = {
  attemptedCount: number;
  categorizedCount: number;
  leftUncategorizedCount: number;
  transactions: AutoCategorizedTransaction[];
  model: string;
};

const MIN_AUTO_ASSIGN_CONFIDENCE = 78;

function chunk<T>(items: T[], size: number) {
  const output: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }

  return output;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function buildUtcDateRange(localDateKey: string) {
  const start = new Date(`${localDateKey}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return {
    gte: start,
    lt: end
  };
}

export async function autoCategorizeTransactions(
  input: AutoCategorizeTransactionsInput = {}
): Promise<AutoCategorizeTransactionsResult> {
  const env = getAppEnv();
  if (!env.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is required for AI categorization.");
  }

  const userId = await getDefaultUserId();
  const categories = await listCategories();
  const categoryOptions: CategorizationCategoryOption[] = categories.map((category) => ({
    key: category.key,
    label: category.label,
    parentKey: category.parentKey
  }));
  const categoryIdByKey = new Map(
    categories.map((category) => [category.key, category.id])
  );

  const limit = Math.max(1, Math.min(input.limit ?? 100, 100));
  const linkedInstitutions = await prisma.plaidItem.findMany({
    where: {
      userId
    },
    select: {
      institutionName: true
    }
  });

  const candidateRows = await prisma.transaction.findMany({
    where: {
      userId,
      reviewStatus: TransactionReviewStatus.uncategorized,
      ...(input.transactionIds && input.transactionIds.length > 0
        ? {
            id: {
              in: input.transactionIds
            }
          }
        : {}),
      ...(input.localDateKey
        ? {
            date: buildUtcDateRange(input.localDateKey)
          }
        : {})
    },
    orderBy: [
      {
        date: "desc"
      },
      {
        createdAt: "desc"
      }
    ],
    take: limit,
    select: {
      id: true,
      date: true,
      name: true,
      merchantName: true,
      amount: true,
      direction: true,
      personalFinanceCategory: true,
      account: {
        select: {
          name: true,
          type: true,
          subtype: true,
          plaidItem: {
            select: {
              institutionName: true
            }
          }
        }
      }
    }
  });

  if (candidateRows.length === 0) {
    return {
      attemptedCount: 0,
      categorizedCount: 0,
      leftUncategorizedCount: 0,
      transactions: [],
      model: env.openAiModel
    };
  }

  const candidates: TransactionCategorizationCandidate[] = candidateRows.map(
    (transaction) => ({
      id: transaction.id,
      date: transaction.date.toISOString().slice(0, 10),
      name: transaction.name,
      merchantName: transaction.merchantName,
      amount: transaction.amount.toString(),
      direction: transaction.direction,
      accountName: transaction.account.name,
      accountType: transaction.account.type,
      accountSubtype: transaction.account.subtype,
      institutionName: transaction.account.plaidItem.institutionName,
      personalFinanceCategory: transaction.personalFinanceCategory
    })
  );

  const suggestionMap = new Map<string, CategorizationSuggestion>();
  for (const group of chunk(candidates, 20)) {
    const suggestions = await categorizeTransactionsWithAi({
      apiKey: env.openAiApiKey,
      model: env.openAiModel,
      categories: categoryOptions,
      linkedInstitutionNames: uniqueStrings(
        linkedInstitutions.map((item) => item.institutionName)
      ),
      today: todayKey(),
      transactions: group
    });

    for (const suggestion of suggestions) {
      suggestionMap.set(suggestion.transactionId, suggestion);
    }
  }

  const updatedTransactions: AutoCategorizedTransaction[] = [];
  let categorizedCount = 0;
  let leftUncategorizedCount = 0;

  for (const candidate of candidates) {
    const suggestion = suggestionMap.get(candidate.id);
    const normalizedCategoryKey = suggestion?.categoryKey?.trim().toLowerCase();
    const assignedCategoryId =
      normalizedCategoryKey && categoryIdByKey.has(normalizedCategoryKey)
        ? categoryIdByKey.get(normalizedCategoryKey) ?? null
        : null;
    const confidence = suggestion?.confidence ?? null;
    const shouldAutoAssign =
      assignedCategoryId !== null &&
      normalizedCategoryKey !== "uncategorized" &&
      confidence !== null &&
      confidence >= MIN_AUTO_ASSIGN_CONFIDENCE;

    const updated = await prisma.transaction.update({
      where: {
        id: candidate.id
      },
      data: {
        categoryId: shouldAutoAssign ? assignedCategoryId : null,
        aiSuggestedCategoryId: assignedCategoryId,
        aiSuggestedConfidence: confidence,
        aiSuggestedReason: suggestion?.reason ?? null,
        aiSuggestedByModel: env.openAiModel,
        aiSuggestedAt: new Date(),
        reviewStatus: shouldAutoAssign
          ? TransactionReviewStatus.auto_categorized
          : TransactionReviewStatus.uncategorized
      },
      select: {
        id: true,
        name: true,
        merchantName: true,
        reviewStatus: true,
        category: {
          select: {
            key: true,
            label: true
          }
        }
      }
    });

    if (shouldAutoAssign) {
      categorizedCount += 1;
    } else {
      leftUncategorizedCount += 1;
    }

    updatedTransactions.push({
      id: updated.id,
      name: updated.name,
      merchantName: updated.merchantName,
      assignedCategoryKey: updated.category?.key ?? null,
      assignedCategoryLabel: updated.category?.label ?? null,
      confidence: suggestion?.confidence ?? null,
      reason: suggestion?.reason ?? null,
      reviewStatus: updated.reviewStatus
    });
  }

  return {
    attemptedCount: candidates.length,
    categorizedCount,
    leftUncategorizedCount,
    transactions: updatedTransactions,
    model: env.openAiModel
  };
}
