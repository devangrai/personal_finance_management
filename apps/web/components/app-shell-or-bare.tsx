"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "./app-shell";

const AUTH_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password"
];

function isAuthPath(path: string): boolean {
  return AUTH_PATHS.some(
    (prefix) => path === prefix || path.startsWith(prefix + "/")
  );
}

/**
 * Wraps all children in the AppShell (header + tabs), UNLESS the
 * current path is an auth page, in which case we render bare so
 * /login etc. don't show the "Overview / Flow / Chat" tabs at all.
 */
export function AppShellOrBare({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  if (isAuthPath(pathname)) {
    return <>{children}</>;
  }
  return <AppShell>{children}</AppShell>;
}
