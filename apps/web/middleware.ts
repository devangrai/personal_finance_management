import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authConfig } from "@/lib/auth.config";

const { auth: authMiddleware } = NextAuth(authConfig);

const PUBLIC_PATHS_EXACT = new Set([
  "/login",
  "/signup",
  "/forgot-password",
  "/favicon.ico",
  "/robots.txt"
]);

const PUBLIC_PREFIXES = [
  "/api/auth/",
  "/api/cron/",
  "/api/plaid/webhook",
  "/api/snaptrade/webhook",
  "/api/daily-review/action/",
  "/reset-password/",
  "/_next/",
  "/assets/"
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS_EXACT.has(pathname)) return true;
  for (const p of PUBLIC_PREFIXES) {
    if (pathname.startsWith(p)) return true;
  }
  return false;
}

/**
 * Route gating middleware.
 * Public paths (auth endpoints, webhooks, cron, signed-token links)
 * pass through. Everything else requires a valid NextAuth JWT session;
 * unauthenticated requests get redirected to /login (pages) or 401 (API).
 *
 * Simulation bypass: requests bearing Authorization: Bearer ${SIM_SECRET}
 * are allowed through for /api/advisor/chat and /api/sim/*. This is how
 * the simulation runner + regression gate talk to the app without a
 * session. SIM_SECRET must be set in env or the bypass is disabled.
 */
export default authMiddleware((request: NextRequest & { auth: unknown }) => {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Simulation bypass — bearer token auth for the runner scripts.
  const simSecret = process.env.SIM_SECRET;
  if (
    simSecret &&
    (pathname.startsWith("/api/advisor/") ||
      pathname.startsWith("/api/sim/") ||
      pathname.startsWith("/api/chat/"))
  ) {
    const authHeader = request.headers.get("authorization");
    if (authHeader === `Bearer ${simSecret}`) {
      return NextResponse.next();
    }
  }

  const auth = request.auth as
    | { user?: { id?: string; isAdmin?: boolean } }
    | null;
  if (auth?.user?.id) {
    // Admin-only paths require isAdmin=true. Non-admin users hitting /admin
    // get bounced to /overview (so they don't see a bare 403 and wonder).
    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      if (!auth.user.isAdmin) {
        const url = request.nextUrl.clone();
        url.pathname = "/overview";
        url.searchParams.set("error", "admin_required");
        return NextResponse.redirect(url);
      }
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
