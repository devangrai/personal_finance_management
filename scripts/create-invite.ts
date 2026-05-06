#!/usr/bin/env -S npx tsx
/**
 * Create a single-use signup invite code.
 *
 * Usage:
 *   CREATED_BY_EMAIL=devang.rai@gmail.com \
 *     INVITED_EMAIL=alice@example.com \
 *     APP_URL=https://personal-finance-management-web-two.vercel.app \
 *     npx tsx scripts/create-invite.ts
 *
 * Env:
 *   CREATED_BY_EMAIL  (required) — an existing admin email
 *   INVITED_EMAIL     (optional) — lock the invite to this address
 *   APP_URL           (optional) — defaults to NEXT_PUBLIC_APP_URL
 *   TTL_DAYS          (optional) — defaults to 7
 *   NOTE              (optional) — free-form note saved with the invite
 *
 * Prints the redeemable URL. Admin can paste it to the invitee.
 */

import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const prisma = new PrismaClient();

function generateCode() {
  return crypto
    .randomBytes(24)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function main() {
  const createdByEmail = (process.env.CREATED_BY_EMAIL ?? "")
    .trim()
    .toLowerCase();
  const invitedEmail = (process.env.INVITED_EMAIL ?? "").trim().toLowerCase();
  const appUrl =
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3001";
  const ttlDays = Number.parseInt(process.env.TTL_DAYS ?? "7", 10);
  const note = process.env.NOTE ?? null;

  if (!createdByEmail) {
    console.error("Set CREATED_BY_EMAIL to an admin's email address.");
    process.exit(1);
  }

  const creator = await prisma.user.findUnique({
    where: { email: createdByEmail }
  });
  if (!creator) {
    console.error(`No user with email ${createdByEmail}.`);
    process.exit(1);
  }
  if (!creator.isAdmin) {
    console.error(
      `${createdByEmail} is not an admin. Run scripts/set-admin.ts first.`
    );
    process.exit(1);
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const invite = await prisma.signupInvite.create({
    data: {
      code,
      intendedEmail: invitedEmail || null,
      createdByUserId: creator.id,
      expiresAt,
      note
    }
  });
  const url = `${appUrl.replace(/\/$/, "")}/signup?code=${code}${
    invitedEmail ? `&email=${encodeURIComponent(invitedEmail)}` : ""
  }`;
  console.log("✓ Invite created.");
  console.log(`  id:         ${invite.id}`);
  console.log(`  code:       ${code}`);
  console.log(`  intended:   ${invitedEmail || "(any email)"}`);
  console.log(`  expires:    ${expiresAt.toISOString()}`);
  console.log(`  url:        ${url}`);
  console.log("");
  console.log("Send the URL above to the invitee. One-shot, expires in",
    `${ttlDays} days.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
