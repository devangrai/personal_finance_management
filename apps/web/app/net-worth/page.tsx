import { NetWorthView } from "@/components/net-worth/net-worth-view";

export const metadata = { title: "Net worth · PFM" };
export const dynamic = "force-dynamic";

export default function NetWorthPage() {
  return (
    <>
      <section className="hero heroCompact">
        <p className="eyebrow">Net worth</p>
        <h1>Your financial picture.</h1>
        <p className="lede">
          Everything you own, minus everything you owe. Connected
          accounts update automatically; add manual items like home
          value or private loans for a complete view.
        </p>
      </section>
      <NetWorthView />
    </>
  );
}
