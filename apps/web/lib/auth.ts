import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@portfolio/db";
import { verifyPassword } from "./password";
import { authConfig } from "./auth.config";

/**
 * Full Auth.js setup (Node runtime — API routes, server actions, server
 * components). Uses the Prisma adapter for database-tracked sessions
 * via JWT handoff (edge middleware verifies the JWT, API routes can
 * also hit the adapter to resolve the full user).
 *
 * Middleware uses lib/auth.config.ts directly (edge-safe, no adapter).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter({
    user: prisma.user,
    account: prisma.authAccount,
    session: prisma.authSession,
    verificationToken: prisma.authVerificationToken
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any),
  providers: [
    // Replace the stub provider from authConfig with the real one that
    // touches Prisma + bcryptjs.
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(creds) {
        const emailRaw = creds?.email;
        const passwordRaw = creds?.password;
        if (!emailRaw || !passwordRaw) return null;
        const email = String(emailRaw).trim().toLowerCase();
        const password = String(passwordRaw);
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;
        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email ?? undefined,
          name: user.displayName ?? undefined,
          // Carried into the JWT so middleware can gate /admin
          isAdmin: user.isAdmin
        };
      }
    })
  ]
});
