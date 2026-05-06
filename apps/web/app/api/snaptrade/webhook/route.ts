import { NextRequest, NextResponse } from "next/server";
import { prisma, SnapTradeConnectionStatus } from "@portfolio/db";
import {
  syncAllConnections,
  verifyWebhookSignature
} from "@/lib/snaptrade";

/**
 * SnapTrade webhook sink. Possible events:
 *   - ACCOUNT_HOLDINGS_UPDATED     (triggers resync)
 *   - CONNECTION_ATTEMPTED
 *   - CONNECTION_ADDED / CONNECTION_DELETED
 *   - CONNECTION_BROKEN            (disabled connection)
 *   - CONNECTION_FIXED             (reconnected)
 *   - USER_REGISTERED
 *   - CONNECTION_UPDATED
 *
 * We verify the HMAC signature in the "snaptrade-signature" header
 * before acting, then either trigger a sync or flip a connection status.
 */

type WebhookEvent = {
  webhookId?: string;
  eventType?: string;
  eventTimestamp?: string;
  userId?: string;
  authorizationId?: string;
  brokerageAuthorizationId?: string;
  details?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("snaptrade-signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json(
      { error: "invalid signature" },
      { status: 401 }
    );
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400 }
    );
  }

  // Normalize the authorization id — the field name varies across events.
  const authId = event.authorizationId ?? event.brokerageAuthorizationId;

  switch (event.eventType) {
    case "ACCOUNT_HOLDINGS_UPDATED":
    case "CONNECTION_ADDED":
    case "CONNECTION_FIXED":
    case "CONNECTION_UPDATED":
      // Fire-and-forget refresh so we ack the webhook quickly.
      void syncAllConnections().catch(() => undefined);
      break;

    case "CONNECTION_BROKEN":
    case "CONNECTION_DELETED":
      if (authId) {
        await prisma.snapTradeConnection.updateMany({
          where: { authorizationId: authId },
          data: {
            status: SnapTradeConnectionStatus.disabled,
            disabledReason:
              event.eventType === "CONNECTION_BROKEN"
                ? "connection marked broken by SnapTrade"
                : "connection deleted at brokerage"
          }
        });
      }
      break;

    default:
      // USER_REGISTERED, CONNECTION_ATTEMPTED, etc. — no action needed.
      break;
  }

  return NextResponse.json({ ok: true });
}
