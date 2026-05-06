#!/usr/bin/env -S npx tsx
/**
 * Reset a user's password. Strictly by email match — no legacy
 * owner@example.com fallback, no row creation. Fails if the user
 * doesn't exist.
 *
 * Usage:
 *   TARGET_EMAIL=someone@example.com NEW_PASSWORD='new-password' \
 *     npx tsx scripts/reset-user-password.ts
 *
 * Safe because: operates ONLY on the row with TARGET_EMAIL exact match.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.TARGET_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.NEW_PASSWORD ?? "";
  if (!email || !password) {
    console.error(
      "Set TARGET_EMAIL and NEW_PASSWORD env vars, then rerun."
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("NEW_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    console.error(`No user with email ${email}. Aborting (no row created).`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: existing.id },
    data: {
      passwordHash: hash,
      emailVerified: existing.emailVerified ?? new Date()
    }
  });
  console.log(
    `✓ Password reset for ${existing.email} (${existing.id}). They can sign in at /login now.`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
