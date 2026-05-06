import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import {
  Prisma,
  SnapTradeConnectionStatus,
  prisma
} from "@portfolio/db";
import {
  createSnapTradeClient,
  type SnapTradeClient
} from "@portfolio/snaptrade";
import { encryptString, decryptString } from "./crypto";
import { getAppEnv } from "./env";
import { getOrCreateDefaultUser } from "./user";

// ---------------------------------------------------------------------------
// Client helpers
// ---------------------------------------------------------------------------

function getClient(): SnapTradeClient {
  const env = getAppEnv();
  if (!env.snapTradeClientId || !env.snapTradeConsumerKey) {
    throw new Error(
      "SnapTrade is not configured. Set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY."
    );
  }
  return createSnapTradeClient({
    clientId: env.snapTradeClientId,
    consumerKey: env.snapTradeConsumerKey
  });
}

function getEncryptionKey(): string {
  return getAppEnv().encryptionKey;
}

// ---------------------------------------------------------------------------
// SnapTradeUser: create once per app-user, store their userSecret encrypted.
// ---------------------------------------------------------------------------

export type SnapTradeUserRecord = {
  id: string;
  userId: string;
  snaptradeUserId: string;
  snaptradeUserSecret: string; // decrypted, for internal use
};

/**
 * Return the caller's SnapTradeUser row, creating one (and calling
 * SnapTrade's /register) if it doesn't exist yet.
 */
export async function ensureSnapTradeUser(): Promise<SnapTradeUserRecord> {
  // Fail fast if SnapTrade isn't configured — prevents cryptic
  // "table does not exist" errors when Prisma is queried against an
  // un-migrated DB in a fresh environment.
  const env = getAppEnv();
  if (!env.snapTradeClientId || !env.snapTradeConsumerKey) {
    throw new Error(
      "SnapTrade is not configured. Set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY in your environment."
    );
  }

  const user = await getOrCreateDefaultUser();
  const existing = await prisma.snapTradeUser.findUnique({
    where: { userId: user.id }
  });
  if (existing) {
    return {
      id: existing.id,
      userId: existing.userId,
      snaptradeUserId: existing.snaptradeUserId,
      snaptradeUserSecret: decryptString(
        existing.snaptradeUserSecretEncrypted,
        getEncryptionKey()
      )
    };
  }

  // SnapTrade recommends an opaque non-PII identifier.
  const snaptradeUserId = `pfm-${user.id}-${randomUUID().slice(0, 8)}`;
  const client = getClient();

  const response = await client.authentication.registerSnapTradeUser({
    userId: snaptradeUserId
  });
  const userSecret = response.data.userSecret;
  if (!userSecret) {
    throw new Error("SnapTrade did not return a userSecret on register.");
  }

  const created = await prisma.snapTradeUser.create({
    data: {
      userId: user.id,
      snaptradeUserId,
      snaptradeUserSecretEncrypted: encryptString(userSecret, getEncryptionKey())
    }
  });

  return {
    id: created.id,
    userId: created.userId,
    snaptradeUserId: created.snaptradeUserId,
    snaptradeUserSecret: userSecret
  };
}

// ---------------------------------------------------------------------------
// Connect flow: generate a Connection Portal URL.
// ---------------------------------------------------------------------------

export async function generateConnectionUrl(options?: {
  broker?: string; // e.g. "FIDELITY" to pre-select
  customRedirect?: string;
}) {
  const st = await ensureSnapTradeUser();
  const client = getClient();
  const env = getAppEnv();
  const customRedirect =
    options?.customRedirect ??
    new URL("/snaptrade/return", env.appUrl).toString();

  const response = await client.authentication.loginSnapTradeUser({
    userId: st.snaptradeUserId,
    userSecret: st.snaptradeUserSecret,
    broker: options?.broker,
    customRedirect,
    connectionType: "read" // we only read data; no trading
  });

  // The SDK returns { redirectURI } OR, for v2 flows, { sessionId }. We
  // only care about the URL form.
  const data = response.data as { redirectURI?: string };
  if (!data.redirectURI) {
    throw new Error("SnapTrade did not return a redirectURI.");
  }
  return { redirectURI: data.redirectURI };
}

// ---------------------------------------------------------------------------
// Sync: pull fresh connections / accounts / activities after connect or
// webhook. Idempotent — safe to call anytime.
// ---------------------------------------------------------------------------

const DEFAULT_ACCOUNT_BUCKET_BY_TYPE: Record<
  string,
  "taxable" | "retirement" | "other"
> = {
  "": "other",
  // SnapTrade-style type hints → our bucket. Cash / sweep accounts are
  // bucketed as "other" because our ManualInvestmentBucket enum doesn't
  // have a "cash" value (and cash inside a brokerage isn't really an
  // investment anyway).
  CASH: "other",
  MARGIN: "taxable",
  TFSA: "taxable",
  BROKERAGE: "taxable",
  TAXABLE: "taxable",
  IRA: "retirement",
  "ROTH IRA": "retirement",
  "TRADITIONAL IRA": "retirement",
  "401K": "retirement",
  "ROTH 401K": "retirement",
  HSA: "other",
  SEP: "retirement",
  "SEP IRA": "retirement"
};

function inferBucket(
  accountType: string | null | undefined
): "taxable" | "retirement" | "other" {
  const key = (accountType ?? "").toUpperCase().trim();
  if (DEFAULT_ACCOUNT_BUCKET_BY_TYPE[key]) {
    return DEFAULT_ACCOUNT_BUCKET_BY_TYPE[key];
  }
  if (key.includes("IRA")) return "retirement";
  if (key.includes("401")) return "retirement";
  if (key.includes("ROTH")) return "retirement";
  if (key) return "taxable";
  return "other";
}

/**
 * Full refresh: list connections, upsert each, pull accounts + activities
 * for each, persist into our ManualInvestment* tables.
 *
 * Intentionally fetches in series so we don't blow the 250/min rate limit
 * on free-tier keys.
 */
export async function syncAllConnections(): Promise<{
  connectionsSynced: number;
  accountsSynced: number;
  activitiesWritten: number;
  holdingsWritten: number;
}> {
  const st = await ensureSnapTradeUser();
  const client = getClient();
  const env = getAppEnv();

  let connectionsSynced = 0;
  let accountsSynced = 0;
  let activitiesWritten = 0;
  let holdingsWritten = 0;

  // 1) Connections (brokerage authorizations)
  const authResp = await client.connections.listBrokerageAuthorizations({
    userId: st.snaptradeUserId,
    userSecret: st.snaptradeUserSecret
  });
  const authorizations = authResp.data ?? [];

  for (const auth of authorizations) {
    if (!auth.id) continue;
    const brokerage = (auth.brokerage ?? {}) as {
      slug?: string | null;
      name?: string | null;
    };
    const brokerageSlug = brokerage.slug ?? "unknown";
    const brokerageName = brokerage.name ?? "Unknown brokerage";

    await prisma.snapTradeConnection.upsert({
      where: { authorizationId: auth.id },
      create: {
        userId: st.userId,
        snapTradeUserId: st.id,
        authorizationId: auth.id,
        brokerageSlug,
        brokerageName,
        status: auth.disabled
          ? SnapTradeConnectionStatus.disabled
          : SnapTradeConnectionStatus.active,
        disabledReason: auth.disabled ? "snaptrade reports disabled" : null,
        lastSyncedAt: new Date()
      },
      update: {
        brokerageSlug,
        brokerageName,
        status: auth.disabled
          ? SnapTradeConnectionStatus.disabled
          : SnapTradeConnectionStatus.active,
        disabledReason: auth.disabled ? "snaptrade reports disabled" : null,
        lastSyncedAt: new Date()
      }
    });
    connectionsSynced += 1;
  }

  // 2) Accounts
  const accountsResp = await client.accountInformation.listUserAccounts({
    userId: st.snaptradeUserId,
    userSecret: st.snaptradeUserSecret
  });
  const accounts = accountsResp.data ?? [];

  for (const account of accounts) {
    if (!account.id) continue;
    const authorizationId = account.brokerage_authorization;
    const connection = authorizationId
      ? await prisma.snapTradeConnection.findUnique({
          where: { authorizationId }
        })
      : null;

    const accountKey = `snaptrade:${account.id}`;
    const rawType = (account.meta?.type as string | undefined) ?? null;
    const bucket = inferBucket(rawType);
    const totalValue = account.balance?.total?.amount ?? null;

    // Upsert the ManualInvestmentAccount row we already use for CSV
    // imports. source="snaptrade" is the discriminator.
    const manualAccount = await prisma.manualInvestmentAccount.upsert({
      where: { accountKey },
      create: {
        userId: st.userId,
        source: "snaptrade",
        accountKey,
        name: account.name ?? "SnapTrade account",
        subtype: rawType,
        bucket,
        isoCurrencyCode: account.balance?.total?.currency ?? "USD",
        lastImportedAt: new Date(),
        snapTradeConnectionId: connection?.id ?? null
      },
      update: {
        name: account.name ?? undefined,
        subtype: rawType ?? undefined,
        bucket,
        snapTradeConnectionId: connection?.id ?? null,
        lastImportedAt: new Date()
      }
    });
    accountsSynced += 1;

    // Persist a fresh holdings snapshot + activities.
    if (totalValue !== null && totalValue !== undefined) {
      // One aggregate row representing the whole-account balance at a
      // point in time. Detailed per-position holdings are pulled below
      // via positions endpoint.
      await prisma.manualHoldingSnapshot.create({
        data: {
          userId: st.userId,
          manualInvestmentAccountId: manualAccount.id,
          rowFingerprint: `account-total-${new Date().toISOString().slice(0, 10)}`,
          asOf: new Date(),
          symbol: null,
          securityName: "Aggregate account value",
          quantity: null,
          institutionPrice: null,
          institutionValue: new Prisma.Decimal(String(totalValue)),
          isoCurrencyCode: account.balance?.total?.currency ?? "USD",
          rawRow: account as unknown as Prisma.InputJsonValue
        }
      }).catch(() => {
        // Dup-on-same-day is fine; skip silently.
      });
      holdingsWritten += 1;
    }

    // 3) Positions (current holdings)
    try {
      const positionsResp = await client.accountInformation.getUserAccountPositions({
        userId: st.snaptradeUserId,
        userSecret: st.snaptradeUserSecret,
        accountId: account.id
      });
      const positions = positionsResp.data ?? [];
      const today = new Date();
      for (const pos of positions) {
        const raw = pos as Record<string, unknown>;
        const symbol = (raw.symbol as { symbol?: { raw_symbol?: string | null } } | null)
          ?.symbol?.raw_symbol ?? null;
        const secName = (raw.symbol as { symbol?: { description?: string } } | null)
          ?.symbol?.description ?? symbol ?? "Unknown security";
        const units = raw.units as number | null | undefined;
        const price = raw.price as number | null | undefined;
        const equity =
          units !== null && units !== undefined && price !== null && price !== undefined
            ? units * price
            : null;
        const fingerprint = `position-${symbol ?? secName}-${today
          .toISOString()
          .slice(0, 10)}`;
        await prisma.manualHoldingSnapshot.create({
          data: {
            userId: st.userId,
            manualInvestmentAccountId: manualAccount.id,
            rowFingerprint: fingerprint,
            asOf: today,
            symbol,
            securityName: secName,
            quantity:
              units !== null && units !== undefined
                ? new Prisma.Decimal(String(units))
                : null,
            institutionPrice:
              price !== null && price !== undefined
                ? new Prisma.Decimal(String(price))
                : null,
            institutionValue:
              equity !== null ? new Prisma.Decimal(String(equity)) : null,
            isoCurrencyCode: "USD",
            rawRow: pos as unknown as Prisma.InputJsonValue
          }
        }).catch(() => {
          // ignore dup
        });
        holdingsWritten += 1;
      }
    } catch {
      // Positions endpoint flaky on first sync; don't fail the whole run.
    }
  }

  // 4) Activities (transactions) — pulled once for the whole user, not
  // per-account, because SnapTrade exposes them at user level.
  try {
    const activitiesResp = await client.transactionsAndReporting.getActivities({
      userId: st.snaptradeUserId,
      userSecret: st.snaptradeUserSecret,
      startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
    });
    const activities = activitiesResp.data ?? [];
    for (const activity of activities) {
      const raw = activity as Record<string, unknown>;
      const activityId = raw.id as string | undefined;
      const accountId = (raw.account as { id?: string } | undefined)?.id;
      if (!activityId || !accountId) continue;
      const accountKey = `snaptrade:${accountId}`;
      const manualAccount = await prisma.manualInvestmentAccount.findUnique({
        where: { accountKey }
      });
      if (!manualAccount) continue;

      const symbol = ((raw.symbol as { symbol?: { raw_symbol?: string | null } } | null)
        ?.symbol?.raw_symbol ?? null) as string | null;
      const secName =
        ((raw.symbol as { symbol?: { description?: string } } | null)
          ?.symbol?.description as string | undefined) ??
        (raw.description as string | undefined) ??
        symbol ??
        "";

      const type = (raw.type as string | undefined) ?? "other";
      const subtype = (raw.option_type as string | undefined) ?? null;
      const amount = (raw.amount as number | undefined) ?? 0;
      const units = (raw.units as number | null | undefined) ?? null;
      const price = (raw.price as number | null | undefined) ?? null;
      const fees = (raw.fee as number | null | undefined) ?? null;
      const tradeDate =
        (raw.trade_date as string | undefined) ??
        (raw.settlement_date as string | undefined);
      if (!tradeDate) continue;

      try {
        await prisma.manualInvestmentTransaction.upsert({
          where: {
            manualInvestmentAccountId_rowFingerprint: {
              manualInvestmentAccountId: manualAccount.id,
              rowFingerprint: activityId
            }
          },
          create: {
            userId: st.userId,
            manualInvestmentAccountId: manualAccount.id,
            rowFingerprint: activityId,
            symbol,
            name: secName,
            type,
            subtype,
            amount: new Prisma.Decimal(String(amount)),
            quantity:
              units !== null ? new Prisma.Decimal(String(units)) : null,
            price:
              price !== null ? new Prisma.Decimal(String(price)) : null,
            fees: fees !== null ? new Prisma.Decimal(String(fees)) : null,
            date: new Date(tradeDate),
            isoCurrencyCode:
              ((raw.currency as { code?: string } | undefined)?.code as
                | string
                | undefined) ?? "USD",
            rawRow: raw as unknown as Prisma.InputJsonValue
          },
          update: {
            // intentionally narrow — the authoritative fields rarely change
            amount: new Prisma.Decimal(String(amount)),
            date: new Date(tradeDate)
          }
        });
        activitiesWritten += 1;
      } catch {
        // keep going on per-row errors
      }
    }
  } catch {
    // fetchActivities can 502 transiently — don't fail the whole sync
  }

  // Stamp connection sync time
  await prisma.snapTradeConnection.updateMany({
    where: { userId: st.userId },
    data: { lastSyncedAt: new Date() }
  });

  // Silence unused-var complaint about env
  void env;

  return {
    connectionsSynced,
    accountsSynced,
    activitiesWritten,
    holdingsWritten
  };
}

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

/**
 * SnapTrade signs webhook payloads with HMAC-SHA256 using your consumer
 * key as the secret (or the separate webhook-secret if you configured
 * one in the dashboard). Returns true if the signature matches.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null
): boolean {
  if (!signature) return false;
  const env = getAppEnv();
  const secret = env.snapTradeWebhookSecret ?? env.snapTradeConsumerKey;
  if (!secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

export async function disconnectConnection(connectionId: string) {
  const st = await ensureSnapTradeUser();
  const connection = await prisma.snapTradeConnection.findFirst({
    where: { id: connectionId, userId: st.userId }
  });
  if (!connection) throw new Error("Connection not found");

  const client = getClient();
  await client.connections.removeBrokerageAuthorization({
    userId: st.snaptradeUserId,
    userSecret: st.snaptradeUserSecret,
    authorizationId: connection.authorizationId
  });

  await prisma.snapTradeConnection.update({
    where: { id: connection.id },
    data: { status: SnapTradeConnectionStatus.disabled }
  });
}
