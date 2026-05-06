import { prisma } from "@portfolio/db";
import type { Session } from "next-auth";

/**
 * Resolve the user for the current request.
 *
 * REQUEST CONTEXT (API route, server component, server action):
 *   - auth() returns a session; we look up the user by session.user.id
 *   - throws if no session; middleware should have intercepted unauth'd
 *     requests, so reaching here without a session means a
 *     request-path-missing-auth bug (fail loudly, don't silently return
 *     some other user's data).
 *
 * NON-REQUEST CONTEXT (cron, scripts):
 *   - auth() throws; we fall back to "first user by createdAt"
 *   - this path is deprecated — cron routes should now pass userId
 *     explicitly to the downstream helper. Kept for test harnesses
 *     and the odd utility that hasn't been migrated yet.
 */
export async function getOrCreateDefaultUser() {
  let session: Session | null = null;
  let inRequestContext = false;
  try {
    // Dynamic import so vitest doesn't try to resolve next-auth's
    // next/server at test collection time.
    const { auth } = await import("./auth");
    // Reaching this point without throwing implies we're inside a
    // Next.js request context (server component, API route, etc.).
    // Mark the flag BEFORE awaiting the session so we fail loudly if
    // a request context has no session.
    inRequestContext = true;
    session = (await (auth as unknown as () => Promise<Session | null>)()) ??
      null;
  } catch {
    // auth() threw → we're outside a request context (cron/script).
    // Fall through to the scripts-only path below.
    inRequestContext = false;
  }

  if (session?.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id }
    });
    if (!user) {
      throw new Error("Session user not found in database.");
    }
    return user;
  }

  // If we got here WITH a request context, the session was missing.
  // Don't fall through to first-user — that would silently hand over
  // someone else's data. EXCEPT: if the request came in via the
  // simulation bearer token (SIM_SECRET), fall through to first-user.
  // We can detect this by checking the sim header flag set in the
  // middleware shim, but easier: consult the NEXT_REQUEST_HEADERS
  // injected via next/headers at the handler level. For simplicity
  // just honour a process-level opt-in: if SIM_SECRET is set AND the
  // request has the bypass header, allow first-user fallback. In
  // practice, simulations set both.
  if (inRequestContext) {
    // In Next 15+, we can read incoming request headers via the
    // next/headers helper. Use dynamic import so non-request contexts
    // (scripts) don't crash on it.
    try {
      const { headers } = await import("next/headers");
      const h = await headers();
      const authHeader = h.get("authorization");
      const simSecret = process.env.SIM_SECRET;
      if (
        simSecret &&
        authHeader &&
        authHeader === `Bearer ${simSecret}`
      ) {
        const first = await prisma.user.findFirst({
          orderBy: { createdAt: "asc" }
        });
        if (first) return first;
      }
    } catch {
      // headers() throws outside request context — ignore and fall
      // through to the error below.
    }
    throw new Error(
      "No authenticated user in request context. Middleware should have redirected unauthenticated traffic; reaching this path is a bug."
    );
  }

  // Non-request fallback path (cron, scripts, test harnesses). Prefer
  // the first user by createdAt for backward compatibility.
  const first = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" }
  });
  if (!first) {
    throw new Error(
      "No users in the database. Run scripts/create-or-update-user.ts to create one."
    );
  }
  return first;
}
