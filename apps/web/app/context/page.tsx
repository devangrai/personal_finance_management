import { PersonalContextEditor } from "@/components/context/personal-context-editor";
import { GoalsList } from "@/components/context/goals-list";
import { LessonsPanel } from "@/components/context/lessons-panel";
import { QuickFactsGrid } from "@/components/context/quick-facts-grid";
import { RecentUpdatesPanel } from "@/components/context/recent-updates-panel";
import { listUserFacts } from "@/lib/user-facts";
import { listAllGoals } from "@/lib/goals";
import {
  listAgentLessons,
  listPendingCandidates
} from "@/lib/advisor-lessons";

export const metadata = { title: "Context · PFM" };
// Always render fresh; the advisor is stateful and we want the latest
// facts / lessons / goals every visit.
export const dynamic = "force-dynamic";

function getPersonalContextText(facts: Awaited<ReturnType<typeof listUserFacts>>) {
  const hit = facts.find((f) => f.factKey === "personal_context");
  if (!hit) return "";
  const v = hit.factValue;
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "text" in v) {
    const t = (v as { text?: unknown }).text;
    if (typeof t === "string") return t;
  }
  return "";
}

export default async function ContextPage() {
  const [facts, goals, graduated, pending] = await Promise.all([
    listUserFacts(),
    listAllGoals(),
    listAgentLessons(),
    listPendingCandidates()
  ]);

  const personalContext = getPersonalContextText(facts);

  return (
    <>
      <section className="card">
        <p className="eyebrow">About me</p>
        <h2>Personal context</h2>
        <p className="cardHelp">
          Tell the advisor about your life in your own words. Where you
          live, who depends on you, what you care about. This text is
          prepended to every conversation so the advisor doesn&apos;t
          have to re-learn it.
        </p>
        <PersonalContextEditor initial={personalContext} />
      </section>

      <RecentUpdatesPanel />

      <section className="card">
        <p className="eyebrow">Progress</p>
        <h2>Goals</h2>
        <p className="cardHelp">
          Concrete targets the advisor should track and reference. You
          can add, edit, or retire goals anytime.
        </p>
        <GoalsList
          goals={goals.map((g) => ({
            id: g.id,
            goalKey: g.goalKey,
            label: g.label,
            targetValue: g.targetValue,
            targetDate: g.targetDate,
            commitment: g.commitment,
            isActive: g.isActive
          }))}
        />
      </section>

      <section className="card">
        <p className="eyebrow">Memory</p>
        <h2>What the advisor has learned</h2>
        <p className="cardHelp">
          Patterns staged by the nightly reviewer. Accept the ones that
          match how you want the advisor to behave; reject the ones that
          don&apos;t.
        </p>
        <LessonsPanel
          pending={pending.map((c) => ({
            id: c.id,
            kind: c.kind,
            topic: c.topic,
            patternSummary: c.patternSummary,
            clusterStrength: c.clusterStrength,
            createdAt: c.createdAt
          }))}
          graduated={graduated.map((g) => ({
            id: g.id,
            kind: g.kind,
            topic: g.topic,
            patternSummary: g.patternSummary,
            actionOrCaveat: g.actionOrCaveat,
            timesApplied: g.timesApplied,
            lastAppliedAt: g.lastAppliedAt,
            graduatedAt: g.graduatedAt
          }))}
        />
      </section>

      <section className="card">
        <p className="eyebrow">Reference</p>
        <h2>Quick facts</h2>
        <p className="cardHelp">
          Structured facts the advisor knows about you — automatically
          saved during conversations or imported from your profile.
        </p>
        <QuickFactsGrid
          facts={facts.map((f) => ({
            id: f.id,
            factKey: f.factKey,
            factValue: f.factValue,
            source: f.source,
            confidence: f.confidence,
            notes: f.notes,
            updatedAt: f.updatedAt
          }))}
        />
      </section>
    </>
  );
}
