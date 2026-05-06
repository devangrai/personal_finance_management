import { Suspense } from "react";
import Link from "next/link";
import { PlaidConnectionPanel } from "@/components/plaid-connection-panel";

/**
 * /admin — power-user escape hatch. Renders the full legacy panel
 * unchanged: Plaid connection manager, transaction-review queue,
 * operations console, daily-review trigger, suggested AI rules,
 * paycheck allocation scenarios, and other developer-oriented tools.
 *
 * Normal users live in Overview / Flow / Chat / Context. This route
 * exists so we don't lose access to those dev-facing controls.
 */
export const metadata = { title: "Admin · PFM" };

export default function AdminPage() {
  return (
    <>
      <section className="hero heroCompact">
        <p className="eyebrow">Admin · power-user tools</p>
        <h1>Full control surface.</h1>
        <p className="lede">
          Everything the product does, in one scroll. Meant for
          development, debugging, and importing. Casual users should use
          the main tabs instead.
        </p>
      </section>
      <section className="panel">
        <h2>Admin sub-pages</h2>
        <ul className="adminSubpages">
          <li>
            <Link href="/admin/invites">
              <strong>Invites →</strong>
              <span className="muted">
                Mint single-use signup links for family and friends.
              </span>
            </Link>
          </li>
        </ul>
      </section>
      <Suspense
        fallback={
          <section className="panel">
            <h2>Loading admin console</h2>
            <p className="panelCopy">Booting the full panel…</p>
          </section>
        }
      >
        <PlaidConnectionPanel />
      </Suspense>
    </>
  );
}
