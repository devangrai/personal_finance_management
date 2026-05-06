function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
}

function formatDelta(n: number): { sign: string; label: string; klass: string } {
  if (n === 0) return { sign: "", label: "—", klass: "neutral" };
  const klass = n > 0 ? "positive" : "negative";
  const sign = n > 0 ? "↗" : "↘";
  return {
    sign,
    label: formatCurrency(Math.abs(n)),
    klass
  };
}

export function NetWorthCard(props: {
  netWorth: number;
  investmentBalance: number;
  bankAssets: number;
  liabilities: number;
  accountCount: number;
}) {
  // Delta week-over-week not yet available — deferred. Render bank/invest/debt
  // split instead so the user sees composition.
  return (
    <section className="netWorthCard">
      <p className="eyebrow">Net worth</p>
      <p className="netWorthNumber">{formatCurrency(props.netWorth)}</p>
      <div className="netWorthBreakdown">
        <div>
          <span className="netWorthLabel">Bank</span>
          <span className="netWorthValue">{formatCurrency(props.bankAssets)}</span>
        </div>
        <div>
          <span className="netWorthLabel">Invest</span>
          <span className="netWorthValue">{formatCurrency(props.investmentBalance)}</span>
        </div>
        <div>
          <span className="netWorthLabel">Debt</span>
          <span className="netWorthValue negative">
            -{formatCurrency(props.liabilities)}
          </span>
        </div>
      </div>
      <p className="netWorthMeta">across {props.accountCount} accounts</p>
    </section>
  );
}

export function WeekSummaryCard(props: {
  income: number;
  spent: number;
  net: number;
  source: string | null;
}) {
  const net = formatDelta(props.net);
  return (
    <section className="weekSummaryCard">
      <p className="eyebrow">This week (est.)</p>
      <dl className="weekSummaryStack">
        <div>
          <dt>Income</dt>
          <dd className="positive">+{formatCurrency(props.income)}</dd>
        </div>
        <div>
          <dt>Spent</dt>
          <dd className="negative">-{formatCurrency(props.spent)}</dd>
        </div>
        <div>
          <dt>Net</dt>
          <dd className={net.klass}>
            {net.sign} {net.label}
          </dd>
        </div>
      </dl>
      {props.source ? (
        <p className="weekSummaryFootnote">
          Scaled from {props.source} spending — we&apos;ll move to a true 7-day
          window as more data flows in.
        </p>
      ) : null}
    </section>
  );
}
