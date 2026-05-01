import { Suspense } from "react";
import { PlaidConnectionPanel } from "@/components/plaid-connection-panel";

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero heroCompact">
        <p className="eyebrow">Portfolio Financial Manager</p>
        <h1>Track the paycheck, review the money flow, and turn it into advice.</h1>
        <p className="lede">
          The product now centers on three daily jobs: understand what moved,
          validate what the AI labeled, and decide what the next paycheck should do.
        </p>
        <div className="heroBullets">
          <span>Paycheck and retirement flow</span>
          <span>Daily transaction review</span>
          <span>Advisor recommendations and chat</span>
        </div>
      </section>

      <Suspense
        fallback={
          <section className="panel">
            <h2>Loading command center</h2>
            <p className="panelCopy">Loading Plaid dashboard...</p>
          </section>
        }
      >
        <PlaidConnectionPanel />
      </Suspense>
    </main>
  );
}
