import {
  prisma,
  RuleMatchType,
  TransactionReviewStatus
} from "@portfolio/db";
import { getDefaultUserId } from "./categories";

type MatchingCandidate = {
  accountId: string;
  accountName: string | null;
  merchantName: string | null;
  personalFinanceCategory: string | null;
  transactionName: string;
};

type RuleBackfillTransaction = {
  id: string;
  accountId: string;
  name: string;
  merchantName: string | null;
  personalFinanceCategory: string | null;
  account: {
    name: string;
  };
};

type ActiveRule = Awaited<ReturnType<typeof getActiveTransactionRules>>[number];

export type TransactionRuleSuggestion = {
  id: string;
  matchType: "merchant_name" | "transaction_name";
  matchValue: string;
  categoryId: string;
  categoryKey: string;
  categoryLabel: string;
  occurrenceCount: number;
  sampleTransactionIds: string[];
  sampleDescription: string;
  reason: string;
};

function normalizeValue(value: string) {
  return value.trim().toLocaleLowerCase();
}

function matchesExact(candidate: string | null | undefined, expected: string) {
  if (!candidate) {
    return false;
  }

  return normalizeValue(candidate) === normalizeValue(expected);
}

function matchesContains(candidate: string | null | undefined, expected: string) {
  if (!candidate) {
    return false;
  }

  return normalizeValue(candidate).includes(normalizeValue(expected));
}

function testRegex(candidate: string | null | undefined, pattern: string) {
  if (!candidate) {
    return false;
  }

  try {
    return new RegExp(pattern, "i").test(candidate);
  } catch {
    return false;
  }
}

function matchesRule(rule: ActiveRule, candidate: MatchingCandidate) {
  if (rule.accountId && rule.accountId !== candidate.accountId) {
    return false;
  }

  switch (rule.matchType) {
    case RuleMatchType.merchant_name:
      return matchesExact(candidate.merchantName, rule.matchValue);
    case RuleMatchType.transaction_name:
      return matchesExact(candidate.transactionName, rule.matchValue);
    case RuleMatchType.plaid_category:
      return matchesExact(candidate.personalFinanceCategory, rule.matchValue);
    case RuleMatchType.account_name:
      return matchesExact(candidate.accountName, rule.matchValue);
    case RuleMatchType.exact:
      return (
        matchesExact(candidate.merchantName, rule.matchValue) ||
        matchesExact(candidate.transactionName, rule.matchValue)
      );
    case RuleMatchType.contains:
      return (
        matchesContains(candidate.merchantName, rule.matchValue) ||
        matchesContains(candidate.transactionName, rule.matchValue)
      );
    case RuleMatchType.regex:
      return (
        testRegex(candidate.merchantName, rule.matchValue) ||
        testRegex(candidate.transactionName, rule.matchValue)
      );
    default:
      return false;
  }
}

function ruleDisplayName(matchType: RuleMatchType, matchValue: string, categoryLabel: string) {
  switch (matchType) {
    case RuleMatchType.merchant_name:
      return `Merchant "${matchValue}" -> ${categoryLabel}`;
    case RuleMatchType.transaction_name:
      return `Transaction "${matchValue}" -> ${categoryLabel}`;
    case RuleMatchType.plaid_category:
      return `Plaid category "${matchValue}" -> ${categoryLabel}`;
    default:
      return `${matchValue} -> ${categoryLabel}`;
  }
}

export async function getActiveTransactionRules(userId: string) {
  return prisma.transactionRule.findMany({
    where: {
      userId,
      isActive: true
    },
    orderBy: [
      {
        priority: "asc"
      },
      {
        createdAt: "asc"
      }
    ],
    select: {
      id: true,
      name: true,
      priority: true,
      isActive: true,
      matchType: true,
      matchValue: true,
      categoryId: true,
      accountId: true
    }
  });
}

export function findMatchingTransactionRule(
  rules: ActiveRule[],
  candidate: MatchingCandidate
) {
  return rules.find((rule) => matchesRule(rule, candidate)) ?? null;
}

async function applyRuleToMatchingTransactions(rule: ActiveRule & { userId?: string }) {
  const userId = rule.userId ?? (await getDefaultUserId());
  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      reviewStatus: {
        notIn: [
          TransactionReviewStatus.user_categorized,
          TransactionReviewStatus.ignored
        ]
      },
      ...(rule.accountId
        ? {
            accountId: rule.accountId
          }
        : {})
    },
    select: {
      id: true,
      accountId: true,
      name: true,
      merchantName: true,
      personalFinanceCategory: true,
      account: {
        select: {
          name: true
        }
      }
    }
  });

  const matchingTransactionIds = transactions
    .filter((transaction: RuleBackfillTransaction) =>
      matchesRule(rule, {
        accountId: transaction.accountId,
        accountName: transaction.account.name,
        merchantName: transaction.merchantName,
        personalFinanceCategory: transaction.personalFinanceCategory,
        transactionName: transaction.name
      })
    )
    .map((transaction: RuleBackfillTransaction) => transaction.id);

  if (matchingTransactionIds.length === 0) {
    return 0;
  }

  const response = await prisma.transaction.updateMany({
    where: {
      id: {
        in: matchingTransactionIds
      }
    },
    data: {
      categoryId: rule.categoryId,
      reviewStatus: TransactionReviewStatus.auto_categorized
    }
  });

  return response.count;
}

async function createOrReuseRule(input: {
  userId: string;
  matchType: RuleMatchType;
  matchValue: string;
  categoryId: string;
  categoryLabel: string;
}) {
  const existingRule = await prisma.transactionRule.findFirst({
    where: {
      userId: input.userId,
      isActive: true,
      matchType: input.matchType,
      matchValue: input.matchValue,
      categoryId: input.categoryId,
      accountId: null
    },
    select: {
      id: true,
      name: true,
      priority: true,
      isActive: true,
      matchType: true,
      matchValue: true,
      categoryId: true,
      accountId: true
    }
  });

  const rule =
    existingRule ??
    (await prisma.transactionRule.create({
      data: {
        userId: input.userId,
        name: ruleDisplayName(
          input.matchType,
          input.matchValue,
          input.categoryLabel
        ),
        matchType: input.matchType,
        matchValue: input.matchValue,
        categoryId: input.categoryId
      },
      select: {
        id: true,
        name: true,
        priority: true,
        isActive: true,
        matchType: true,
        matchValue: true,
        categoryId: true,
        accountId: true
      }
    }));

  const appliedCount = await applyRuleToMatchingTransactions({
    ...rule,
    userId: input.userId
  });

  return {
    existed: Boolean(existingRule),
    appliedCount,
    rule
  };
}

export async function createRuleFromTransaction(input: { transactionId: string }) {
  const userId = await getDefaultUserId();
  const transaction = await prisma.transaction.findFirst({
    where: {
      id: input.transactionId,
      userId
    },
    select: {
      id: true,
      name: true,
      merchantName: true,
      personalFinanceCategory: true,
      accountId: true,
      categoryId: true,
      category: {
        select: {
          id: true,
          label: true
        }
      }
    }
  });

  if (!transaction) {
    throw new Error("Transaction not found.");
  }

  if (!transaction.categoryId || !transaction.category) {
    throw new Error("Choose a review category before creating a rule.");
  }

  const matchType = transaction.merchantName
    ? RuleMatchType.merchant_name
    : RuleMatchType.transaction_name;
  const matchValue = transaction.merchantName ?? transaction.name;

  return createOrReuseRule({
    userId,
    matchType,
    matchValue,
    categoryId: transaction.categoryId,
    categoryLabel: transaction.category.label
  });
}

function buildSuggestionReason(
  matchType: "merchant_name" | "transaction_name",
  occurrenceCount: number
) {
  if (matchType === RuleMatchType.merchant_name) {
    return `Merchant repeated ${occurrenceCount} times with the same reviewed category.`;
  }

  return `Description repeated ${occurrenceCount} times with the same reviewed category.`;
}

function buildSuggestionKey(input: {
  matchType: "merchant_name" | "transaction_name";
  matchValue: string;
  categoryId: string;
}) {
  return `${input.matchType}::${normalizeValue(input.matchValue)}::${input.categoryId}`;
}

export async function listSuggestedTransactionRules() {
  const userId = await getDefaultUserId();
  const activeRules = await getActiveTransactionRules(userId);
  const existingRuleKeys = new Set(
    activeRules.map((rule) =>
      buildSuggestionKey({
        matchType:
          rule.matchType === RuleMatchType.merchant_name
            ? RuleMatchType.merchant_name
            : RuleMatchType.transaction_name,
        matchValue: rule.matchValue,
        categoryId: rule.categoryId
      })
    )
  );

  const candidates = await prisma.transaction.findMany({
    where: {
      userId,
      reviewStatus: {
        in: [
          TransactionReviewStatus.auto_categorized,
          TransactionReviewStatus.user_categorized
        ]
      },
      categoryId: {
        not: null
      },
      aiSuggestedConfidence: {
        gte: 90
      }
    },
    orderBy: [
      {
        date: "desc"
      },
      {
        createdAt: "desc"
      }
    ],
    select: {
      id: true,
      name: true,
      merchantName: true,
      categoryId: true,
      category: {
        select: {
          key: true,
          label: true
        }
      }
    }
  });

  const grouped = new Map<string, TransactionRuleSuggestion>();

  for (const transaction of candidates) {
    if (!transaction.categoryId || !transaction.category) {
      continue;
    }

    const matchType = transaction.merchantName
      ? RuleMatchType.merchant_name
      : RuleMatchType.transaction_name;
    const matchValue = transaction.merchantName ?? transaction.name;
    const groupKey = buildSuggestionKey({
      matchType,
      matchValue,
      categoryId: transaction.categoryId
    });

    const existing = grouped.get(groupKey);
    if (existing) {
      existing.occurrenceCount += 1;
      if (existing.sampleTransactionIds.length < 3) {
        existing.sampleTransactionIds.push(transaction.id);
      }
      continue;
    }

    grouped.set(groupKey, {
      id: groupKey,
      matchType,
      matchValue,
      categoryId: transaction.categoryId,
      categoryKey: transaction.category.key,
      categoryLabel: transaction.category.label,
      occurrenceCount: 1,
      sampleTransactionIds: [transaction.id],
      sampleDescription: transaction.name,
      reason: ""
    });
  }

  return Array.from(grouped.values())
    .filter(
      (suggestion) =>
        suggestion.occurrenceCount >= 2 &&
        !existingRuleKeys.has(
          buildSuggestionKey({
            matchType: suggestion.matchType,
            matchValue: suggestion.matchValue,
            categoryId: suggestion.categoryId
          })
        )
    )
    .sort((left, right) => right.occurrenceCount - left.occurrenceCount)
    .map((suggestion) => ({
      ...suggestion,
      reason: buildSuggestionReason(
        suggestion.matchType,
        suggestion.occurrenceCount
      )
    }))
    .slice(0, 12);
}

export async function applySuggestedTransactionRules(input?: {
  suggestionIds?: string[];
}) {
  const userId = await getDefaultUserId();
  const suggestions = await listSuggestedTransactionRules();
  const selectedSuggestions =
    input?.suggestionIds && input.suggestionIds.length > 0
      ? suggestions.filter((suggestion) =>
          input.suggestionIds?.includes(suggestion.id)
        )
      : suggestions;

  const results = [];

  for (const suggestion of selectedSuggestions) {
    const result = await createOrReuseRule({
      userId,
      matchType: suggestion.matchType,
      matchValue: suggestion.matchValue,
      categoryId: suggestion.categoryId,
      categoryLabel: suggestion.categoryLabel
    });

    results.push({
      ...suggestion,
      existed: result.existed,
      appliedCount: result.appliedCount,
      ruleId: result.rule.id,
      ruleName: result.rule.name
    });
  }

  return {
    appliedSuggestionCount: results.length,
    rulesCreatedCount: results.filter((result) => !result.existed).length,
    transactionsAffectedCount: results.reduce(
      (sum, result) => sum + result.appliedCount,
      0
    ),
    results
  };
}
