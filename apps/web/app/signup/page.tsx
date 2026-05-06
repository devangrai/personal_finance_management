import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata = { title: "Sign up · PFM" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ code?: string; email?: string }>;

export default async function SignupPage(props: {
  searchParams: SearchParams;
}) {
  const { code, email } = await props.searchParams;
  return (
    <div className="authShell">
      <div className="authCard">
        <p className="eyebrow">Portfolio Financial Manager</p>
        <h1 className="authTitle">Create your account</h1>
        <p className="authSubtitle">
          Invite-only for now. Use the link sent by someone who already
          has an account.
        </p>
        <SignupForm
          initialCode={code ?? ""}
          initialEmail={email ?? ""}
        />
        <div className="authLinks">
          <Link href="/login">Already have an account? Sign in</Link>
        </div>
      </div>
    </div>
  );
}
