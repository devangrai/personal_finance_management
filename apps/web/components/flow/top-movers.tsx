"use client";

type TopMover = {
  categoryKey: string;
  label: string;
  amount: number;
  previousAmount: number;
  deltaPct: number | null;
  flag: "up" | "down" | "flat";
};

function currency(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function deltaLabel(m: TopMover): { text: string; klass: string } {
  if (m.deltaPct === null) {
    return { text: "new", klass: "flat" };
  }
  if (m.previousAmount === 0 && m.amount === 0) {
    return { text: "—", klass: "flat" };
  }
  const pct = Math.round(m.deltaPct);
  if (pct === 0) return { text: "flat", klass: "flat" };
  return {
    text: `${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)}%`,
    klass: m.flag === "up" ? "up" : m.flag === "down" ? "down" : "flat"
  };
}

export function TopMovers(props: {
  movers: TopMover[];
  onSelect?: (categoryKey: string, label: string) => void;
}) {
  if (props.movers.length === 0) {
    return (
      <p className="emptyLine">No spending yet this window to compare.</p>
    );
  }
  return (
    <ul className="topMoversList">
      {props.movers.map((m) => {
        const delta = deltaLabel(m);
        return (
          <li
            key={m.categoryKey}
            className="topMoverRow"
            onClick={() => props.onSelect?.(m.categoryKey, m.label)}
            role={props.onSelect ? "button" : undefined}
            tabIndex={props.onSelect ? 0 : undefined}
            onKeyDown={(e) => {
              if (
                props.onSelect &&
                (e.key === "Enter" || e.key === " ")
              ) {
                e.preventDefault();
                props.onSelect(m.categoryKey, m.label);
              }
            }}
          >
            <span className="topMoverLabel">{m.label}</span>
            <span className="topMoverAmount">{currency(m.amount)}</span>
            <span className={`topMoverDelta ${delta.klass}`}>{delta.text}</span>
            {m.flag === "up" ? <span className="topMoverFlag">⚠</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
