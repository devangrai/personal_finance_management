#!/usr/bin/env -S npx tsx
/**
 * One-time backfill: run the fact extractor over existing chat history.
 *
 * Walks every user's ChatSessions chronologically, pairs up user+assistant
 * messages, and runs runFactExtractor on each pair. Uses an idempotency
 * marker (UserFact with key="_backfill_completed_at") to prevent double
 * runs — rerunning is a no-op unless you pass --force.
 *
 * Usage:
 *   set -a; source .env; set +a
 *   npx tsx scripts/backfill-facts.ts
 *
 * Options:
 *   --force           ignore the idempotency marker, reprocess everything
 *   --user <email>    only backfill this one user
 *   --dry-run         don't actually write anything; just print what would
 *                     happen. Useful to estimate LLM cost.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MARKER_KEY = "_backfill_completed_at";

type Args = {
  force: boolean;
  userEmail: string | null;
  dryRun: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { force: false, userEmail: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--force") args.force = true;
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--user") args.userEmail = argv[++i] ?? null;
  }
  return args;
}

async function main() {
  const args = parseArgs();

  // Dynamic imports — these modules pull in the full app (env, model pool,
  // etc). Failing them early would be confusing.
  const { runFactExtractor } = await import(
    "../apps/web/lib/advisor-extractor.js"
  ).catch(async () => {
    // Fallback path: ts source when running via tsx
    return await import("../apps/web/lib/advisor-extractor");
  });
  const { buildModelPool } = await import(
    "../apps/web/lib/llm/model-pool"
  );
  const pool = buildModelPool();
  const provider = pool.get("judge");

  const users = await prisma.user.findMany({
    where: args.userEmail ? { email: args.userEmail } : {},
    select: { id: true, email: true }
  });
  if (users.length === 0) {
    console.error("No users found.");
    process.exit(1);
  }

  for (const user of users) {
    console.log(`\n=== User: ${user.email ?? user.id} ===`);

    // Idempotency guard
    if (!args.force) {
      const marker = await prisma.userFact.findUnique({
        where: {
          userId_factKey: { userId: user.id, factKey: MARKER_KEY }
        }
      });
      if (marker) {
        const when =
          typeof marker.factValue === "string"
            ? marker.factValue
            : JSON.stringify(marker.factValue);
        console.log(
          `  → skipped (already backfilled at ${when}). Use --force to redo.`
        );
        continue;
      }
    }

    const sessions = await prisma.chatSession.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      include: {
        messages: { orderBy: { createdAt: "asc" } }
      }
    });

    let pairs = 0;
    let skipped = 0;
    let applied = 0;
    let staged = 0;
    let rejected = 0;

    for (const session of sessions) {
      const msgs = session.messages;
      for (let i = 0; i < msgs.length - 1; i++) {
        const u = msgs[i];
        const a = msgs[i + 1];
        if (u.role !== "user" || a.role !== "assistant") continue;
        pairs++;

        if (args.dryRun) {
          process.stdout.write(".");
          continue;
        }

        // Build history context from prior messages in the same session
        // (up to 6 messages back).
        const priorHistory = msgs
          .slice(Math.max(0, i - 6), i)
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content
          }));

        try {
          const result = await runFactExtractor({
            userId: user.id,
            userMessage: u.content,
            assistantReply: a.content,
            recentHistory: priorHistory,
            sessionId: session.id,
            chatMessageId: a.id,
            provider
          });
          if (result.skipped) skipped++;
          else {
            applied += result.autoApplied;
            staged += result.staged;
            rejected += result.rejected;
          }
        } catch (err) {
          console.warn(
            `\n  ! extractor error on msg ${a.id}:`,
            err instanceof Error ? err.message : err
          );
        }
      }
    }

    console.log(
      `  pairs=${pairs} skipped=${skipped} autoApplied=${applied} staged=${staged} rejected=${rejected}`
    );

    // Write the idempotency marker
    if (!args.dryRun) {
      await prisma.userFact.upsert({
        where: {
          userId_factKey: { userId: user.id, factKey: MARKER_KEY }
        },
        update: { factValue: new Date().toISOString() as never },
        create: {
          userId: user.id,
          factKey: MARKER_KEY,
          factValue: new Date().toISOString() as never,
          source: "manual"
        }
      });
    }
  }

  await prisma.$disconnect();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
