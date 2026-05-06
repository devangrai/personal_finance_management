"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/overview", label: "Overview" },
  { href: "/net-worth", label: "Net worth" },
  { href: "/flow", label: "Flow" },
  { href: "/budget", label: "Budget" },
  { href: "/chat", label: "Chat" },
  { href: "/context", label: "Context" },
  { href: "/documents", label: "Documents" }
] as const;

export function AppNav() {
  const pathname = usePathname() ?? "/overview";
  return (
    <nav className="tabNav" aria-label="Primary navigation">
      {TABS.map((tab) => {
        const isActive =
          pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={
              isActive ? "tabNavItem tabNavItemActive" : "tabNavItem"
            }
            aria-current={isActive ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
      <Link
        href="/admin"
        className="tabNavItem tabNavItemLegacy"
        title="Power-user / development tools"
      >
        Admin
      </Link>
    </nav>
  );
}
