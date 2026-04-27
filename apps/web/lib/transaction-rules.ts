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

type ActiveRule = Awaited<ReturnType<typeof getActiveTransactionRules>>[number];

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
    .filter((transaction) =>
      matchesRule(rule, {
        accountId: transaction.accountId,
        accountName: transaction.account.name,
        merchantName: transaction.merchantName,
        personalFinanceCategory: transaction.personalFinanceCategory,
        transactionName: transaction.name
      })
    )
    .map((transaction) => transaction.id);

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

  const existingRule = await prisma.transactionRule.findFirst({
    where: {
      userId,
      isActive: true,
      matchType,
      matchValue,
      categoryId: transaction.categoryId,
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
        userId,
        name: ruleDisplayName(matchType, matchValue, transaction.category.label),
        matchType,
        matchValue,
        categoryId: transaction.categoryId
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
    userId
  });

  return {
    existed: Boolean(existingRule),
    appliedCount,
    rule
  };
}
