import { prisma, UserFactSource } from "@portfolio/db";
import { getDefaultUserId } from "./categories";

export type UserFactValue =
  | string
  | number
  | boolean
  | null
  | { value: string | number; unit?: string; asOf?: string }
  | Record<string, unknown>;

export type UserFactSnapshot = {
  id: string;
  factKey: string;
  factValue: UserFactValue;
  confidence: number | null;
  source: UserFactSource;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SaveUserFactInput = {
  factKey: string;
  factValue: UserFactValue;
  confidence?: number | null;
  source?: UserFactSource;
  notes?: string | null;
};

function serialize(fact: {
  id: string;
  factKey: string;
  factValue: unknown;
  confidence: number | null;
  source: UserFactSource;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}): UserFactSnapshot {
  return {
    id: fact.id,
    factKey: fact.factKey,
    factValue: fact.factValue as UserFactValue,
    confidence: fact.confidence,
    source: fact.source,
    notes: fact.notes,
    createdAt: fact.createdAt.toISOString(),
    updatedAt: fact.updatedAt.toISOString()
  };
}

export async function listUserFacts(): Promise<UserFactSnapshot[]> {
  const userId = await getDefaultUserId();
  const facts = await prisma.userFact.findMany({
    where: { userId },
    orderBy: [{ factKey: "asc" }]
  });
  return facts.map(serialize);
}

export async function getUserFact(
  factKey: string
): Promise<UserFactSnapshot | null> {
  const userId = await getDefaultUserId();
  const fact = await prisma.userFact.findUnique({
    where: {
      userId_factKey: {
        userId,
        factKey
      }
    }
  });
  return fact ? serialize(fact) : null;
}

export async function saveUserFact(
  input: SaveUserFactInput
): Promise<UserFactSnapshot> {
  const userId = await getDefaultUserId();
  const factKey = input.factKey.trim();
  if (!factKey) {
    throw new Error("factKey is required.");
  }

  let confidence: number | null = null;
  if (input.confidence != null) {
    if (
      !Number.isInteger(input.confidence) ||
      input.confidence < 0 ||
      input.confidence > 100
    ) {
      throw new Error("confidence must be an integer 0-100.");
    }
    confidence = input.confidence;
  }

  const source = input.source ?? UserFactSource.conversation;
  const factValue =
    input.factValue === undefined ? null : (input.factValue as unknown);

  const fact = await prisma.userFact.upsert({
    where: {
      userId_factKey: {
        userId,
        factKey
      }
    },
    update: {
      factValue: factValue as never,
      confidence,
      source,
      notes: input.notes ?? null
    },
    create: {
      userId,
      factKey,
      factValue: factValue as never,
      confidence,
      source,
      notes: input.notes ?? null
    }
  });
  return serialize(fact);
}

export async function deleteUserFact(factKey: string) {
  const userId = await getDefaultUserId();
  await prisma.userFact.deleteMany({
    where: {
      userId,
      factKey
    }
  });
}
