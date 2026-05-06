#!/usr/bin/env -S npx tsx
/**
 * Set or unset admin on a user row.
 *
 * Usage:
 *   ADMIN_EMAIL=devang.rai@gmail.com npx tsx scripts/set-admin.ts
 *   ADMIN_EMAIL=devang.rai@gmail.com UNSET=1 npx tsx scripts/set-admin.ts
 *
 * Safe to re-run. Idempotent.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const unset = process.env.UNSET === "1";
  if (!email) {
    console.error("Set ADMIN_EMAIL env var.");
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { isAdmin: !unset }
  });
  console.log(
    `✓ ${email} is now ${unset ? "NOT an admin" : "an admin"} (user ${user.id}).`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
