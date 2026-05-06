"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const newPassword = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      setPending(false);
      return;
    }
    if (newPassword !== confirm) {
      setError("Passwords don't match.");
      setPending(false);
      return;
    }
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Reset failed.");
        setPending(false);
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 1500);
    } catch {
      setError("Unexpected error. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="authForm">
        <p className="authSubtitle">✓ Password reset. Redirecting to login…</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="authForm">
      <label className="authField">
        <span className="authLabel">New password</span>
        <input
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          disabled={pending}
          className="authInput"
        />
      </label>
      <label className="authField">
        <span className="authLabel">Confirm</span>
        <input
          type="password"
          name="confirm"
          required
          minLength={8}
          autoComplete="new-password"
          disabled={pending}
          className="authInput"
        />
      </label>
      {error ? <p className="errorLine authError">{error}</p> : null}
      <div className="authActions">
        <button type="submit" className="primaryButton" disabled={pending}>
          {pending ? "Saving…" : "Set password"}
        </button>
      </div>
    </form>
  );
}
