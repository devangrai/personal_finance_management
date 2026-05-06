import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

/**
 * Edge-safe Auth.js config.
 *
 * This file is imported by middleware (edge runtime). It defines the
 * providers + routes but does NOT reference the Prisma adapter, bcryptjs,
 * or the database — those would push the edge bundle over the 1 MB
 * Vercel Hobby limit.
 *
 * The `authorize` function here is a stub; the full DB-backed version
 * lives in auth.ts and is used by the Node runtime (API routes,
 * server components, server actions). Middleware uses JWT session
 * tokens which it can verify without touching the database.
 */
export const authConfig = {
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  session: { strategy: "jwt" }, // edge runtime needs JWT, not DB lookup
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {}
      },
      // Stub — overridden in the full auth.ts. Middleware never calls
      // authorize (only callback.authorized), so this is just a type filler.
      async authorize() {
        return null;
      }
    })
  ],
  callbacks: {
    /**
     * Called on every request by middleware. Returns truthy to allow,
     * falsy to redirect to signIn page. We don't enforce per-path logic
     * here — our middleware.ts handles the allow-list for public paths.
     * This callback just says "user is considered signed in iff they
     * have a valid JWT".
     */
    authorized({ auth }) {
      return !!auth?.user;
    },
    async jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      // Carry isAdmin through the JWT so middleware can enforce /admin
      // without a DB hit. Set on first sign-in (when `user` is populated).
      const userWithAdmin = user as { isAdmin?: boolean } | undefined;
      if (userWithAdmin && typeof userWithAdmin.isAdmin === "boolean") {
        token.isAdmin = userWithAdmin.isAdmin;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token?.id) {
        session.user.id = token.id as string;
      }
      if (session.user && typeof token?.isAdmin === "boolean") {
        (session.user as { isAdmin?: boolean }).isAdmin = token.isAdmin;
      }
      return session;
    }
  }
} satisfies NextAuthConfig;
