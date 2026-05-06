import type { TransactionAnomaly } from "./anomaly-detection";
import { signActionToken } from "./action-tokens";

export type DigestTransactionForEmail = {
  id: string;
  displayName: string;
  amount: number; // positive for outflow, negative for inflow
  accountName: string;
  aiSuggestedCategory: {
    id: string;
    label: string;
    key: string;
  } | null;
  currentCategory: {
    id: string;
    label: string;
  } | null;
  reviewStatus: string;
};

export type CategoryOption = { id: string; label: string };

export type BuildEmailInput = {
  localDateKey: string;
  appUrl: string;
  secret: string;
  transactions: DigestTransactionForEmail[];
  anomalies: Map<string, TransactionAnomaly>;
  /** Top N categories to offer as "change to…" links per transaction */
  suggestedCategories: CategoryOption[];
  totals: {
    count: number;
    autoCategorized: number;
    uncategorized: number;
    anomalies: number;
  };
};

export type BuiltEmail = {
  subject: string;
  text: string;
  html: string;
};

/**
 * Render the daily-review email. Each transaction row shows:
 *   - merchant + amount
 *   - AI-assigned category chip
 *   - anomaly reason if any
 *   - Accept link (one-click signed URL)
 *   - "Change to X" links for up to 3 alternative categories
 *   - Flag-as-anomaly link
 */
export function buildDailyReviewEmail(input: BuildEmailInput): BuiltEmail {
  const { localDateKey, appUrl, secret, transactions, anomalies, totals } =
    input;
  const subject =
    totals.anomalies > 0
      ? `Daily review · ${totals.count} transactions · ${totals.anomalies} flagged`
      : `Daily review · ${totals.count} transactions for ${localDateKey}`;

  // --- Text version (fallback for text-only clients)
  const textLines: string[] = [
    `Daily transaction review for ${localDateKey}`,
    "",
    `${totals.count} transaction(s) today · ${totals.autoCategorized} AI-labelled · ${totals.uncategorized} uncategorized` +
      (totals.anomalies > 0 ? ` · ${totals.anomalies} anomal${totals.anomalies === 1 ? "y" : "ies"} flagged` : ""),
    ""
  ];
  for (const t of transactions) {
    const amt = fmtAmount(t.amount);
    const cat = t.currentCategory?.label ?? t.aiSuggestedCategory?.label ?? "uncategorized";
    textLines.push(`- ${t.displayName} ${amt} [${cat}]`);
    const reasons = anomalies.get(t.id)?.reasons ?? [];
    for (const r of reasons) {
      textLines.push(`  ⚠ ${r.message}`);
    }
  }
  textLines.push("", `Open dashboard: ${appUrl}/overview`);

  // --- HTML version
  const rows = transactions
    .map((t) => renderRow(t, anomalies.get(t.id) ?? null, input))
    .join("\n");

  const anomalyBanner =
    totals.anomalies > 0
      ? `<div style="background:rgba(168,68,39,0.12);color:#a84427;padding:0.7rem 1rem;border-radius:10px;margin:0 0 1rem;font-weight:600;">⚠ ${totals.anomalies} transaction${totals.anomalies === 1 ? "" : "s"} worth a second look</div>`
      : "";

  const html = `
<div style="font-family:'Iowan Old Style',Georgia,serif;line-height:1.6;color:#171512;max-width:640px;margin:auto;padding:2rem 1.5rem;background:#efe7da;">
  <div style="background:rgba(255,251,245,0.95);padding:1.75rem 1.75rem 1.5rem;border:1px solid rgba(23,21,18,0.08);border-radius:20px;">
    <p style="margin:0 0 0.2rem;color:#225f59;font-size:0.8rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">Daily review</p>
    <h1 style="margin:0 0 0.25rem;font-size:1.8rem;letter-spacing:-0.02em;">${localDateKey}</h1>
    <p style="margin:0 0 1.2rem;color:#665d4e;font-size:0.95rem;">
      ${totals.count} transaction${totals.count === 1 ? "" : "s"} today ·
      ${totals.autoCategorized} AI-labelled ·
      ${totals.uncategorized} uncategorized
    </p>
    ${anomalyBanner}
    ${transactions.length === 0 ? `<p style="color:#665d4e;">No transactions posted today. Enjoy the break.</p>` : rows}
    <p style="margin-top:1.75rem;text-align:center;">
      <a href="${appUrl}/overview" style="display:inline-block;padding:0.7rem 1.25rem;background:#163d4a;color:#fff;border-radius:12px;text-decoration:none;font-weight:600;font-family:-apple-system,Inter,sans-serif;">Open dashboard →</a>
    </p>
    <p style="margin-top:1rem;font-size:0.78rem;color:#665d4e;opacity:0.75;font-family:-apple-system,Inter,sans-serif;">
      Links are signed and expire in 14 days. Clicking "Accept", "Change", or "Flag" updates your account immediately.
    </p>
  </div>
</div>`.trim();

  return { subject, text: textLines.join("\n"), html };
}

function renderRow(
  t: DigestTransactionForEmail,
  anomaly: TransactionAnomaly | null,
  input: BuildEmailInput
): string {
  const { appUrl, secret, suggestedCategories } = input;
  const amt = fmtAmount(t.amount);
  const amountColor = t.amount > 0 ? "#a84427" : "#225f59";
  const category =
    t.currentCategory?.label ??
    t.aiSuggestedCategory?.label ??
    "uncategorized";
  const categoryChip = renderChip(category);

  // Signed accept link (only when we have an AI suggestion)
  const acceptHref = t.aiSuggestedCategory
    ? linkFor(
        appUrl,
        t.id,
        "accept",
        signActionToken({ subject: t.id, action: "accept", secret })
      )
    : null;

  // Signed change-to links for top N alternative categories. Cap at 3
  // for email bulk — more than that gets noisy.
  const shownChangeOptions = suggestedCategories
    .filter((c) => c.id !== (t.currentCategory?.id ?? t.aiSuggestedCategory?.id))
    .slice(0, 3);
  const changeLinks = shownChangeOptions
    .map((c) => {
      const tok = signActionToken({
        subject: t.id,
        action: `change:${c.id}`,
        secret
      });
      return `<a href="${appUrl}/api/daily-review/action/${t.id}?a=change&c=${c.id}&t=${encodeURIComponent(tok)}" style="${linkStyle()}">${c.label}</a>`;
    })
    .join("");

  // Signed flag-anomaly link
  const flagHref = linkFor(
    appUrl,
    t.id,
    "flag",
    signActionToken({ subject: t.id, action: "flag-anomaly", secret })
  );

  const anomalyBlock = anomaly
    ? `<div style="margin:0.35rem 0 0;padding:0.4rem 0.7rem;background:rgba(168,68,39,0.08);border-left:3px solid #a84427;border-radius:4px;font-size:0.85rem;color:#a84427;font-family:-apple-system,Inter,sans-serif;">
        ${anomaly.reasons.map((r) => `⚠ ${escapeHtml(r.message)}`).join("<br>")}
       </div>`
    : "";

  return `
<div style="padding:0.9rem 0;border-bottom:1px solid rgba(23,21,18,0.08);font-family:-apple-system,Inter,sans-serif;">
  <div style="display:flex;justify-content:space-between;align-items:baseline;gap:1rem;">
    <strong style="flex:1;font-size:0.98rem;color:#171512;">${escapeHtml(t.displayName)}</strong>
    <span style="font-weight:700;color:${amountColor};font-variant-numeric:tabular-nums;">${amt}</span>
  </div>
  <div style="margin-top:0.3rem;color:#665d4e;font-size:0.82rem;">
    ${categoryChip}
    <span style="margin-left:0.5rem;opacity:0.75;">${escapeHtml(t.accountName)}</span>
  </div>
  ${anomalyBlock}
  <div style="margin-top:0.55rem;font-size:0.82rem;">
    ${acceptHref ? `<a href="${acceptHref}" style="${linkStyle("accept")}">Keep ${escapeHtml(t.aiSuggestedCategory?.label ?? "")}</a>` : ""}
    ${changeLinks ? `<span style="color:#665d4e;opacity:0.6;margin:0 0.3rem;">or</span>${changeLinks}` : ""}
    <a href="${flagHref}" style="${linkStyle("flag")}">⚠ Flag</a>
  </div>
</div>`.trim();
}

function linkFor(
  appUrl: string,
  transactionId: string,
  action: "accept" | "change" | "flag",
  token: string
): string {
  return `${appUrl}/api/daily-review/action/${transactionId}?a=${action}&t=${encodeURIComponent(token)}`;
}

function linkStyle(kind: "accept" | "flag" | "default" = "default"): string {
  const color =
    kind === "accept" ? "#225f59" : kind === "flag" ? "#a84427" : "#665d4e";
  return `display:inline-block;padding:0.25rem 0.65rem;margin:0 0.2rem 0.2rem 0;background:rgba(34,95,89,0.08);color:${color};border-radius:999px;text-decoration:none;font-weight:600;font-size:0.78rem;border:1px solid rgba(23,21,18,0.08);`;
}

function renderChip(label: string): string {
  return `<span style="padding:0.1rem 0.5rem;background:rgba(34,95,89,0.1);color:#163d4a;border-radius:999px;font-size:0.74rem;font-weight:600;">${escapeHtml(label)}</span>`;
}

function fmtAmount(amount: number): string {
  const abs = Math.abs(amount).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
  return amount > 0 ? `-${abs}` : `+${abs}`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
