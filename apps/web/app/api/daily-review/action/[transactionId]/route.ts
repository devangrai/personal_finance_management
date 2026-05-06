import { NextRequest } from "next/server";
import { prisma, TransactionReviewStatus } from "@portfolio/db";
import { verifyActionToken } from "@/lib/action-tokens";
import { getAppEnv } from "@/lib/env";

/**
 * One-shot email action endpoint. The token carries:
 *   subject = transactionId
 *   action  = "accept" | "change:<categoryId>" | "flag-anomaly"
 *
 * We verify HMAC, check the action in URL matches the token (anti-replay),
 * mutate the DB, and render a minimal HTML confirmation the user sees
 * in their browser after clicking the email link.
 */

type RouteContext = {
  params: Promise<{ transactionId: string }>;
};

function html(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body { font: 16px/1.5 -apple-system, Georgia, serif; margin: 0; background: #efe7da; color: #171512; }
.wrap { max-width: 560px; margin: 4rem auto; padding: 2rem 2.25rem; background: rgba(255,251,245,0.95); border: 1px solid rgba(23,21,18,0.1); border-radius: 20px; box-shadow: 0 22px 60px rgba(38,31,20,0.08); }
h1 { margin: 0 0 0.5rem; font-family: "Iowan Old Style", Georgia, serif; font-size: 1.6rem; letter-spacing: -0.02em; }
.eyebrow { margin: 0 0 0.25rem; color: #225f59; font-size: 0.8rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
p { color: #665d4e; }
a.btn { display: inline-block; margin-top: 1rem; padding: 0.7rem 1.2rem; background: #163d4a; color: #fff; border-radius: 12px; text-decoration: none; font-weight: 600; }
.ok { color: #225f59; }
.err { color: #a84427; }
</style>
</head><body><div class="wrap">${body}</div></body></html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8" }
    }
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { transactionId } = await context.params;
  const url = request.nextUrl;
  const urlAction = url.searchParams.get("a");
  const token = url.searchParams.get("t");
  const categoryId = url.searchParams.get("c"); // only for change
  const appUrl = getAppEnv().appUrl;

  if (!urlAction || !token) {
    return html(
      "Invalid link",
      `<p class="eyebrow">Invalid</p><h1>Missing action or token.</h1>
       <p>This link looks incomplete. Head back to the app to continue.</p>
       <a class="btn" href="${appUrl}/overview">Open dashboard</a>`,
      400
    );
  }

  const secret = getAppEnv().encryptionKey;
  const verify = verifyActionToken({ token, secret });
  if (!verify.ok) {
    return html(
      "Link expired",
      `<p class="eyebrow">Expired or tampered</p><h1>This link can't be used.</h1>
       <p>${verify.reason}. Tokens expire after 14 days — open the app to make changes directly.</p>
       <a class="btn" href="${appUrl}/overview">Open dashboard</a>`,
      401
    );
  }
  const payload = verify.payload;
  if (payload.subject !== transactionId) {
    return html(
      "Mismatched link",
      `<p class="eyebrow">Mismatched</p><h1>Token doesn't match this transaction.</h1>
       <a class="btn" href="${appUrl}/overview">Open dashboard</a>`,
      400
    );
  }

  // The token's action field encodes what was authorized. Make sure it
  // matches what the URL is claiming so a token for "accept" can't be
  // replayed as "flag-anomaly".
  const tokenAction = payload.action;
  if (urlAction === "accept") {
    if (tokenAction !== "accept") {
      return html("Invalid action", `<h1>Token not valid for accept.</h1>`, 400);
    }
    return await doAccept(transactionId, appUrl);
  }
  if (urlAction === "change") {
    if (!categoryId) {
      return html("Missing category", `<h1>Category id missing.</h1>`, 400);
    }
    const expectedAction = `change:${categoryId}`;
    if (tokenAction !== expectedAction) {
      return html(
        "Invalid change token",
        `<h1>Token doesn't match this category.</h1>`,
        400
      );
    }
    return await doChange(transactionId, categoryId, appUrl);
  }
  if (urlAction === "flag") {
    if (tokenAction !== "flag-anomaly") {
      return html("Invalid action", `<h1>Token not valid for flag.</h1>`, 400);
    }
    return await doFlag(transactionId, appUrl);
  }
  return html("Unknown action", `<h1>Unknown action.</h1>`, 400);
}

async function doAccept(transactionId: string, appUrl: string) {
  const txn = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      aiSuggestedCategoryId: true,
      aiSuggestedCategory: { select: { label: true } },
      merchantName: true,
      name: true
    }
  });
  if (!txn) {
    return html("Not found", `<h1>Transaction not found.</h1>`, 404);
  }
  if (!txn.aiSuggestedCategoryId) {
    return html(
      "Nothing to accept",
      `<h1>No AI suggestion to accept.</h1>
       <p>Open the app to categorize this one manually.</p>
       <a class="btn" href="${appUrl}/overview">Open dashboard</a>`,
      400
    );
  }
  await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      categoryId: txn.aiSuggestedCategoryId,
      reviewStatus: TransactionReviewStatus.user_categorized
    }
  });
  return html(
    "Category confirmed",
    `<p class="eyebrow">Confirmed</p>
     <h1 class="ok">✓ Category kept</h1>
     <p><strong>${txn.merchantName ?? txn.name}</strong> → <strong>${txn.aiSuggestedCategory?.label ?? "category"}</strong>.</p>
     <a class="btn" href="${appUrl}/overview">Open dashboard</a>`
  );
}

async function doChange(
  transactionId: string,
  categoryId: string,
  appUrl: string
) {
  const [txn, category] = await Promise.all([
    prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { id: true, userId: true, merchantName: true, name: true }
    }),
    prisma.transactionCategory.findUnique({
      where: { id: categoryId },
      select: { id: true, label: true, userId: true }
    })
  ]);
  if (!txn || !category) {
    return html("Not found", `<h1>Transaction or category not found.</h1>`, 404);
  }
  if (category.userId !== txn.userId) {
    return html(
      "Invalid category",
      `<h1>That category doesn't belong to your account.</h1>`,
      403
    );
  }
  await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      categoryId,
      reviewStatus: TransactionReviewStatus.user_categorized
    }
  });
  return html(
    "Category updated",
    `<p class="eyebrow">Updated</p>
     <h1 class="ok">✓ Category set</h1>
     <p><strong>${txn.merchantName ?? txn.name}</strong> → <strong>${category.label}</strong>.</p>
     <a class="btn" href="${appUrl}/overview">Open dashboard</a>`
  );
}

async function doFlag(transactionId: string, appUrl: string) {
  const txn = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, notes: true, merchantName: true, name: true }
  });
  if (!txn) {
    return html("Not found", `<h1>Transaction not found.</h1>`, 404);
  }
  const existing = txn.notes ?? "";
  const marker = "[user-flagged-anomaly]";
  const next = existing.includes(marker)
    ? existing
    : (existing ? existing + "\n" : "") + `${marker} flagged from email on ${new Date().toISOString().slice(0, 10)}`;
  await prisma.transaction.update({
    where: { id: transactionId },
    data: { notes: next }
  });
  return html(
    "Flagged",
    `<p class="eyebrow">Flagged</p>
     <h1 class="ok">✓ Anomaly flagged</h1>
     <p>The advisor now knows <strong>${txn.merchantName ?? txn.name}</strong> stood out to you — it'll surface in next turn's context.</p>
     <a class="btn" href="${appUrl}/overview">Open dashboard</a>`
  );
}
