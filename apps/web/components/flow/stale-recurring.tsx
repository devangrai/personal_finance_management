"use client";

type StaleRecurring = {
  displayName: string;
  amount: number;
  frequency: string;
  direction: "credit" | "debit";
  lastSeen: string;
  ageMonths: number;
  note: string;
};

function currency(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function StaleRecurringList(props: {
  items: StaleRecurring[];
  onSelect?: (item: StaleRecurring) => void;
}) {
  if (props.items.length === 0) {
    return (
      <p className="emptyLine">
        Nothing unusual in your recurring flows right now.
      </p>
    );
  }
  return (
    <ul className="staleRecurringList">
      {props.items.map((item) => (
        <li
          key={`${item.displayName}-${item.direction}`}
          className="staleRecurringRow"
          onClick={() => props.onSelect?.(item)}
          role={props.onSelect ? "button" : undefined}
          tabIndex={props.onSelect ? 0 : undefined}
          onKeyDown={(e) => {
            if (
              props.onSelect &&
              (e.key === "Enter" || e.key === " ")
            ) {
              e.preventDefault();
              props.onSelect(item);
            }
          }}
        >
          <div className="staleRecurringMain">
            <strong>{item.displayName}</strong>
            <span className="staleRecurringNote">{item.note}</span>
          </div>
          <div className="staleRecurringRight">
            <span
              className={
                item.direction === "credit"
                  ? "staleRecurringAmount positive"
                  : "staleRecurringAmount"
              }
            >
              {currency(item.amount)}
            </span>
            <span className="staleRecurringFreq">{item.frequency}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
