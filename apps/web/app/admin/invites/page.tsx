import Link from "next/link";
import { InvitesPanel } from "@/components/admin/invites-panel";

export const metadata = { title: "Invites · Admin · PFM" };
export const dynamic = "force-dynamic";

/**
 * /admin/invites — mint + revoke signup invites.
 *
 * Middleware enforces isAdmin on all /admin/* paths. API routes
 * (/api/admin/*) also re-check isAdmin server-side.
 */
export default function InvitesPage() {
  return (
    <>
      <section className="hero heroCompact">
        <p className="eyebrow">
          <Link href="/admin">Admin</Link> · invites
        </p>
        <h1>Invite family or friends.</h1>
        <p className="lede">
          Mint a single-use signup link and send it to them via any
          channel. They create their own password and land directly
          in the app — no email verification step.
        </p>
      </section>
      <InvitesPanel />
    </>
  );
}
