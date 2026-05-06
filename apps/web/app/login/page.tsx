import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "Sign in · PFM" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ next?: string }>;

export default async function LoginPage(props: { searchParams: SearchParams }) {
  const { next } = await props.searchParams;
  const safeNext = next && next.startsWith("/") ? next : "/overview";
  return (
    <div className="authShell">
      <div className="authCard">
        <p className="eyebrow">Portfolio Financial Manager</p>
        <h1 className="authTitle">Sign in</h1>
        <p className="authSubtitle">
          Welcome back. Your money&apos;s been waiting.
        </p>
        <LoginForm next={safeNext} />
      </div>
    </div>
  );
}
