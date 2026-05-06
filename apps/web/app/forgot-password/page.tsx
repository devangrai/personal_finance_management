import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata = { title: "Reset password · PFM" };

export default function ForgotPasswordPage() {
  return (
    <div className="authShell">
      <div className="authCard">
        <p className="eyebrow">Portfolio Financial Manager</p>
        <h1 className="authTitle">Forgot your password?</h1>
        <p className="authSubtitle">
          Enter the email tied to your account and we&apos;ll send a
          reset link.
        </p>
        <ForgotPasswordForm />
        <div className="authLinks">
          <Link href="/login">← Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
