import type { Metadata } from "next";
import "./globals.css";
import { AppShellOrBare } from "@/components/app-shell-or-bare";

export const metadata: Metadata = {
  title: "Portfolio Financial Manager",
  description:
    "Open-source personal finance manager for Plaid-linked transactions and portfolio analysis."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShellOrBare>{children}</AppShellOrBare>
      </body>
    </html>
  );
}
