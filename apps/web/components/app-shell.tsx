import Link from "next/link";
import { AppNav } from "./app-nav";
import { logoutAction } from "@/app/login/actions";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="appHeader">
        <div className="shell appHeaderInner">
          <Link href="/overview" className="appBrand">
            <span className="appBrandMark">PFM</span>
            <span className="appBrandWord">Portfolio Financial Manager</span>
          </Link>
          <div className="appHeaderRight">
            <form action={logoutAction}>
              <button type="submit" className="linkButton appLogoutButton">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="shell">
        <AppNav />
        <main>{children}</main>
      </div>
    </>
  );
}
