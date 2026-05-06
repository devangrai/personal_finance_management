import { BudgetGrid } from "@/components/budget/budget-grid";

export const metadata = { title: "Budget · PFM" };
export const dynamic = "force-dynamic";

export default function BudgetPage() {
  return (
    <>
      <section className="hero heroCompact">
        <p className="eyebrow">Budget</p>
        <h1>Track spending against monthly budgets.</h1>
        <p className="lede">
          Set a monthly target for each category. Pace yourself through
          the month with a clear view of where you are versus plan.
        </p>
      </section>
      <BudgetGrid />
    </>
  );
}
