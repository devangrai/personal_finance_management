import { PlaidConnectionPanel } from "@/components/plaid-connection-panel";

const layers = [
  {
    name: "Data ingestion",
    description:
      "Plaid Link, token exchange, account sync, transaction sync, investment holdings, and webhooks."
  },
  {
    name: "Finance system",
    description:
      "Canonical accounts, transactions, holdings, category rules, recurring spend, and monthly summaries."
  },
  {
    name: "Advisor layer",
    description:
      "Structured tools that generate explainable recommendations from your cash flow and portfolio state."
  }
];

const milestones = [
  "Connect accounts and persist Plaid Items securely",
  "Categorize transactions with rules and manual review",
  "Aggregate investment accounts into a single portfolio view",
  "Recommend retirement contribution amounts from actual cash flow"
];

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Portfolio Financial Manager</p>
        <h1>Personal finance infrastructure first. Advisor logic second.</h1>
        <p className="lede">
          The MVP is shaped around reliable Plaid ingestion, clean
          categorization, and a traceable recommendation system.
        </p>
      </section>

      <section className="panel">
        <h2>System layers</h2>
        <div className="grid">
          {layers.map((layer) => (
            <article key={layer.name} className="card">
              <h3>{layer.name}</h3>
              <p>{layer.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>First milestones</h2>
        <ul className="list">
          {milestones.map((milestone) => (
            <li key={milestone}>{milestone}</li>
          ))}
        </ul>
      </section>

      <PlaidConnectionPanel />
    </main>
  );
}
