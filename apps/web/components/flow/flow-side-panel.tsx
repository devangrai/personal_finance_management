"use client";

type Selection =
  | {
      kind: "link";
      sourceLabel: string;
      targetLabel: string;
      value: number;
      count: number;
    }
  | {
      kind: "node";
      label: string;
      nodeType: string;
      value: number;
    }
  | {
      kind: "category";
      label: string;
      amount: number;
      deltaPct: number | null;
    }
  | {
      kind: "recurring";
      displayName: string;
      amount: number;
      frequency: string;
      lastSeen: string;
      note: string;
    };

function currency(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function FlowSidePanel(props: {
  selection: Selection | null;
  onClose: () => void;
}) {
  const open = props.selection !== null;
  return (
    <div
      className={open ? "flowSidePanel open" : "flowSidePanel"}
      aria-hidden={!open}
    >
      <div className="flowSidePanelInner">
        <button
          type="button"
          className="flowSidePanelClose"
          onClick={props.onClose}
          aria-label="Close detail panel"
        >
          ×
        </button>
        {props.selection ? <Body s={props.selection} /> : null}
      </div>
    </div>
  );
}

function Body({ s }: { s: Selection }) {
  switch (s.kind) {
    case "link":
      return (
        <>
          <p className="eyebrow">Flow</p>
          <h3>
            {s.sourceLabel} → {s.targetLabel}
          </h3>
          <p className="flowSidePanelValue">{currency(s.value)}</p>
          <p className="flowSidePanelMeta">
            {s.count} transaction{s.count === 1 ? "" : "s"} in this window
          </p>
          <p className="flowSidePanelHint">
            Drill-down into the specific transactions for this flow is coming
            soon. For now you can see all transactions on the{" "}
            <a href="/overview">Overview tab</a>.
          </p>
        </>
      );
    case "node":
      return (
        <>
          <p className="eyebrow">{s.nodeType}</p>
          <h3>{s.label}</h3>
          <p className="flowSidePanelValue">{currency(s.value)}</p>
          <p className="flowSidePanelHint">
            Total in or out of this node for the selected window.
          </p>
        </>
      );
    case "category":
      return (
        <>
          <p className="eyebrow">Category</p>
          <h3>{s.label}</h3>
          <p className="flowSidePanelValue">{currency(s.amount)} / mo</p>
          {s.deltaPct !== null ? (
            <p className="flowSidePanelMeta">
              {s.deltaPct > 0 ? "+" : ""}
              {Math.round(s.deltaPct)}% vs prior window
            </p>
          ) : null}
          <p className="flowSidePanelHint">
            Use the chat to ask "Why is my {s.label.toLowerCase()} spending so
            high?" and the advisor will pull the specific transactions.
          </p>
        </>
      );
    case "recurring":
      return (
        <>
          <p className="eyebrow">Recurring flow</p>
          <h3>{s.displayName}</h3>
          <p className="flowSidePanelValue">
            {currency(s.amount)} {s.frequency}
          </p>
          <p className="flowSidePanelMeta">{s.note}</p>
          <p className="flowSidePanelHint">
            Ask the advisor "Should I cancel {s.displayName}?" and I&apos;ll
            look at your usage patterns and your savings goals to help decide.
          </p>
        </>
      );
  }
}
