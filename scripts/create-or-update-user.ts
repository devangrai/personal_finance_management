#!/usr/bin/env -S npx tsx
/**
 * Seed or update the admin user.
 *
 * Usage:
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='your-new-password' \
 *     npx tsx scripts/create-or-update-user.ts
 *
 * What it does:
 *   - Looks for an existing user by ADMIN_EMAIL OR the legacy
 *     owner@example.com; if found, updates the email + password hash.
 *   - If neither exists, creates a new user row.
 *   - Marks emailVerified = now() so the user can log in immediately.
 *
 * SAFE TO RE-RUN: idempotent. Running twice just rehashes the password.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) {
    console.error(
      "Set ADMIN_EMAIL and ADMIN_PASSWORD env vars, then rerun."
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("ADMIN_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }

  // Prefer existing owner@example.com row if present (that's where our
  // legacy data lives). Otherwise match by provided email, else create.
  const legacyEmail = "owner@example.com";
  const existing =
    (await prisma.user.findUnique({ where: { email: legacyEmail } })) ??
    (await prisma.user.findUnique({ where: { email } }));

  const hash = await bcrypt.hash(password, 12);
  const now = new Date();

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        email,
        passwordHash: hash,
        emailVerified: existing.emailVerified ?? now,
        displayName: existing.displayName ?? "Admin"
      }
    });
    console.log(`✓ Updated user ${updated.id} (${updated.email}).`);
  } else {
    const created = await prisma.user.create({
      data: {
        email,
        passwordHash: hash,
        emailVerified: now,
        displayName: "Admin"
      }
    });
    console.log(`✓ Created user ${created.id} (${created.email}).`);
  }

  console.log(
    `Done. You can now log in at /login with ${email} and the password you set.`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
