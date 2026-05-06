"use client";

type Fact = {
  id: string;
  factKey: string;
  factValue: unknown;
  source: string;
  confidence: number | null;
  notes: string | null;
  updatedAt: string;
};

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function prettyKey(k: string): string {
  return k
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * Read-only quick-facts grid. Structured fact editing will come in a
 * follow-up; for now this just surfaces what the advisor knows, so the
 * user can see it.
 */
export function QuickFactsGrid(props: { facts: Fact[] }) {
  const visible = props.facts.filter((f) => f.factKey !== "personal_context");
  if (visible.length === 0) {
    return <p className="emptyLine">No structured facts yet.</p>;
  }
  return (
    <dl className="quickFactsGrid">
      {visible.map((f) => (
        <div className="quickFactsItem" key={f.id}>
          <dt>{prettyKey(f.factKey)}</dt>
          <dd>
            <span>{renderValue(f.factValue)}</span>
            <span className="quickFactsSource">{f.source}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
