import { prisma } from "@portfolio/db";
import { getDefaultUserId } from "./categories";

export type UserGoalSnapshot = {
  id: string;
  goalKey: string;
  label: string;
  targetValue: string | null;
  targetDate: string | null;
  commitment: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UpsertUserGoalInput = {
  goalKey: string;
  label: string;
  targetValue?: string | number | null;
  targetDate?: string | null;
  commitment?: string | null;
  isActive?: boolean;
};

function centsToDollarString(value: bigint | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  return (Number(value) / 100).toFixed(2);
}

function dollarsToCents(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Goal target value must be a number.");
  }
  return BigInt(Math.round(parsed * 100));
}

function parseIsoDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid targetDate: "${value}".`);
  }
  return parsed;
}

function serializeGoal(goal: {
  id: string;
  goalKey: string;
  label: string;
  targetValueCents: bigint | null;
  targetDate: Date | null;
  commitment: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): UserGoalSnapshot {
  return {
    id: goal.id,
    goalKey: goal.goalKey,
    label: goal.label,
    targetValue: centsToDollarString(goal.targetValueCents),
    targetDate: goal.targetDate?.toISOString() ?? null,
    commitment: goal.commitment,
    isActive: goal.isActive,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString()
  };
}

export async function listActiveGoals(): Promise<UserGoalSnapshot[]> {
  const userId = await getDefaultUserId();
  const goals = await prisma.userGoal.findMany({
    where: {
      userId,
      isActive: true
    },
    orderBy: [{ createdAt: "desc" }]
  });
  return goals.map(serializeGoal);
}

export async function listAllGoals(): Promise<UserGoalSnapshot[]> {
  const userId = await getDefaultUserId();
  const goals = await prisma.userGoal.findMany({
    where: { userId },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }]
  });
  return goals.map(serializeGoal);
}

export async function upsertGoal(
  input: UpsertUserGoalInput
): Promise<UserGoalSnapshot> {
  const userId = await getDefaultUserId();
  const goalKey = input.goalKey.trim();
  if (!goalKey) {
    throw new Error("goalKey is required.");
  }
  const label = input.label.trim();
  if (!label) {
    throw new Error("label is required.");
  }

  const targetValueCents = dollarsToCents(input.targetValue);
  const targetDate = parseIsoDate(input.targetDate);
  const isActive = input.isActive ?? true;

  const goal = await prisma.userGoal.upsert({
    where: {
      userId_goalKey: {
        userId,
        goalKey
      }
    },
    update: {
      label,
      targetValueCents,
      targetDate,
      commitment: input.commitment ?? null,
      isActive
    },
    create: {
      userId,
      goalKey,
      label,
      targetValueCents,
      targetDate,
      commitment: input.commitment ?? null,
      isActive
    }
  });

  return serializeGoal(goal);
}

export async function deactivateGoal(goalId: string): Promise<UserGoalSnapshot> {
  const userId = await getDefaultUserId();
  const existing = await prisma.userGoal.findFirst({
    where: { id: goalId, userId }
  });
  if (!existing) {
    throw new Error("Goal not found.");
  }
  const goal = await prisma.userGoal.update({
    where: { id: goalId },
    data: { isActive: false }
  });
  return serializeGoal(goal);
}
