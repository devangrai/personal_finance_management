import { prisma } from "@portfolio/db";
import { getDefaultUserId } from "./categories";

export type UserProfileSnapshot = {
  birthYear: number | null;
  dependents: number;
  housingStatus: "rent_free" | "rent" | "mortgage" | "other";
  annualIncome: string | null;
  biweeklyNetPay: string | null;
  monthlyFixedExpense: string | null;
  emergencyFundTarget: string | null;
  targetRetirementSavingsRate: string | null;
  notes: string | null;
};

type UpdateUserProfileInput = Partial<{
  birthYear: number | null;
  dependents: number | null;
  housingStatus: UserProfileSnapshot["housingStatus"];
  annualIncome: string | number | null;
  biweeklyNetPay: string | number | null;
  monthlyFixedExpense: string | number | null;
  emergencyFundTarget: string | number | null;
  targetRetirementSavingsRate: string | number | null;
  notes: string | null;
}>;

function formatCents(value: bigint | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  return (Number(value) / 100).toFixed(2);
}

function parseOptionalCents(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Dollar-denominated profile values must be valid numbers.");
  }

  return BigInt(Math.round(parsed * 100));
}

function parseOptionalInt(value: number | null | undefined, fieldName: string) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isInteger(value)) {
    throw new Error(`${fieldName} must be a whole number.`);
  }

  return value;
}

function parseOptionalBps(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Target retirement savings rate must be a valid percentage.");
  }

  return Math.round(parsed * 100);
}

export async function getOrCreateUserProfile() {
  const userId = await getDefaultUserId();
  const profile = await prisma.userProfile.upsert({
    where: {
      userId
    },
    update: {},
    create: {
      userId
    },
    select: {
      birthYear: true,
      dependents: true,
      housingStatus: true,
      annualIncomeCents: true,
      biweeklyNetPayCents: true,
      monthlyFixedExpenseCents: true,
      currentEmergencyFundTargetCents: true,
      targetRetirementSavingsRateBps: true,
      notes: true
    }
  });

  return {
    birthYear: profile.birthYear,
    dependents: profile.dependents,
    housingStatus: profile.housingStatus,
    annualIncome: formatCents(profile.annualIncomeCents),
    biweeklyNetPay: formatCents(profile.biweeklyNetPayCents),
    monthlyFixedExpense: formatCents(profile.monthlyFixedExpenseCents),
    emergencyFundTarget: formatCents(profile.currentEmergencyFundTargetCents),
    targetRetirementSavingsRate:
      profile.targetRetirementSavingsRateBps === null
        ? null
        : (profile.targetRetirementSavingsRateBps / 100).toFixed(2),
    notes: profile.notes
  } satisfies UserProfileSnapshot;
}

export async function updateUserProfile(input: UpdateUserProfileInput) {
  const userId = await getDefaultUserId();

  await prisma.userProfile.upsert({
    where: {
      userId
    },
    update: {
      birthYear:
        input.birthYear !== undefined
          ? parseOptionalInt(input.birthYear, "Birth year")
          : undefined,
      dependents:
        input.dependents !== undefined
          ? parseOptionalInt(input.dependents, "Dependents") ?? 0
          : undefined,
      housingStatus: input.housingStatus,
      annualIncomeCents:
        input.annualIncome !== undefined
          ? parseOptionalCents(input.annualIncome)
          : undefined,
      biweeklyNetPayCents:
        input.biweeklyNetPay !== undefined
          ? parseOptionalCents(input.biweeklyNetPay)
          : undefined,
      monthlyFixedExpenseCents:
        input.monthlyFixedExpense !== undefined
          ? parseOptionalCents(input.monthlyFixedExpense)
          : undefined,
      currentEmergencyFundTargetCents:
        input.emergencyFundTarget !== undefined
          ? parseOptionalCents(input.emergencyFundTarget)
          : undefined,
      targetRetirementSavingsRateBps:
        input.targetRetirementSavingsRate !== undefined
          ? parseOptionalBps(input.targetRetirementSavingsRate)
          : undefined,
      notes:
        input.notes !== undefined ? input.notes?.trim() || null : undefined
    },
    create: {
      userId,
      birthYear: parseOptionalInt(input.birthYear ?? null, "Birth year"),
      dependents: parseOptionalInt(input.dependents ?? null, "Dependents") ?? 0,
      housingStatus: input.housingStatus ?? "rent_free",
      annualIncomeCents: parseOptionalCents(input.annualIncome),
      biweeklyNetPayCents: parseOptionalCents(input.biweeklyNetPay),
      monthlyFixedExpenseCents: parseOptionalCents(input.monthlyFixedExpense),
      currentEmergencyFundTargetCents: parseOptionalCents(
        input.emergencyFundTarget
      ),
      targetRetirementSavingsRateBps: parseOptionalBps(
        input.targetRetirementSavingsRate
      ),
      notes: input.notes?.trim() || null
    }
  });

  return getOrCreateUserProfile();
}
