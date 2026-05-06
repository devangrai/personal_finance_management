import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata = { title: "Set new password · PFM" };

type Params = Promise<{ token: string }>;

export default async function ResetPasswordPage(props: { params: Params }) {
  const { token } = await props.params;
  return (
    <div className="authShell">
      <div className="authCard">
        <p className="eyebrow">Portfolio Financial Manager</p>
        <h1 className="authTitle">Set a new password</h1>
        <p className="authSubtitle">
          Pick something you&apos;ll remember. Minimum 8 characters.
        </p>
        <ResetPasswordForm token={decodeURIComponent(token)} />
      </div>
    </div>
  );
}
