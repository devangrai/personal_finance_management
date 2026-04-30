type TransactionNormalizationCandidate = {
  name: string;
  merchantName?: string | null;
  direction: "debit" | "credit";
  personalFinanceCategory?: string | null;
  accountName?: string | null;
  accountType?: string | null;
  accountSubtype?: string | null;
  institutionName?: string | null;
};

type TransactionNormalizationInput = {
  candidate: TransactionNormalizationCandidate;
  linkedInstitutionNames: string[];
};

export type DeterministicCategoryAssignment = {
  categoryKey:
    | "transfer"
    | "savings_transfer"
    | "investing"
    | "retirement_contribution"
    | "paycheck";
  confidence: number;
  reason: string;
};

const payrollPattern =
  /\b(payroll|salary|direct\s+deposit|direct\s+dep|paychex|adp|gusto|trinet|rippling|insperity)\b/i;
const peerTransferPattern = /\b(zelle|venmo|cash app)\b/i;
const creditCardPaymentPattern =
  /\b(payment\s+thank\s+you|credit\s+card\s+payment|card\s+payment|online\s+payment|autopay|auto\s+pay)\b/i;
const retirementPattern =
  /\b(roth|traditional\s+ira|ira\s+contribution|401k|403b|457|retirement)\b/i;
const investingPattern =
  /\b(fidelity|vanguard|schwab|brokerage|investment|investing|robinhood|webull|m1 finance|etrade|e\*trade)\b/i;
const savingsPattern =
  /\b(wealthfront|cash\s+account|high\s+yield|savings)\b/i;

function normalizeText(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function combineText(candidate: TransactionNormalizationCandidate) {
  return [
    candidate.name,
    candidate.merchantName,
    candidate.personalFinanceCategory
  ]
    .filter(Boolean)
    .join(" ");
}

function findMentionedLinkedInstitution(text: string, linkedInstitutionNames: string[]) {
  return linkedInstitutionNames.find((institutionName) => {
    const normalizedInstitutionName = normalizeText(institutionName);
    return normalizedInstitutionName.length >= 4 && text.includes(normalizedInstitutionName);
  });
}

function inferTransferLikeCategoryFromText(text: string) {
  if (retirementPattern.test(text)) {
    return {
      categoryKey: "retirement_contribution" as const,
      confidence: 97,
      reason: "Descriptor looks like a retirement account contribution."
    };
  }

  if (investingPattern.test(text)) {
    return {
      categoryKey: "investing" as const,
      confidence: 94,
      reason: "Descriptor points to a brokerage or investment transfer."
    };
  }

  if (savingsPattern.test(text)) {
    return {
      categoryKey: "savings_transfer" as const,
      confidence: 92,
      reason: "Descriptor looks like a savings or cash-reserve transfer."
    };
  }

  return {
    categoryKey: "transfer" as const,
    confidence: 90,
    reason: "Descriptor looks like a transfer between your own accounts."
  };
}

export function classifyTransactionDeterministically(
  input: TransactionNormalizationInput
): DeterministicCategoryAssignment | null {
  const text = combineText(input.candidate);
  const normalizedText = normalizeText(text);
  const normalizedPlaidCategory = normalizeText(
    input.candidate.personalFinanceCategory
  );

  if (
    input.candidate.direction === "credit" &&
    payrollPattern.test(text) &&
    !peerTransferPattern.test(text)
  ) {
    return {
      categoryKey: "paycheck",
      confidence: 95,
      reason: "Descriptor looks like payroll or direct-deposit income."
    };
  }

  if (peerTransferPattern.test(text)) {
    return {
      categoryKey: "transfer",
      confidence: 88,
      reason: "Peer-to-peer transfer descriptors are treated as account transfers."
    };
  }

  if (
    normalizedPlaidCategory.includes("transfer") ||
    normalizedPlaidCategory.includes("credit_card_payment") ||
    creditCardPaymentPattern.test(text)
  ) {
    return inferTransferLikeCategoryFromText(text);
  }

  const linkedInstitutionMatch = findMentionedLinkedInstitution(
    normalizedText,
    input.linkedInstitutionNames
  );
  if (linkedInstitutionMatch) {
    return inferTransferLikeCategoryFromText(linkedInstitutionMatch);
  }

  if (retirementPattern.test(text)) {
    return {
      categoryKey: "retirement_contribution",
      confidence: 96,
      reason: "Descriptor looks like a retirement account contribution."
    };
  }

  if (investingPattern.test(text)) {
    return {
      categoryKey: "investing",
      confidence: 92,
      reason: "Descriptor looks like an investment transfer."
    };
  }

  return null;
}
