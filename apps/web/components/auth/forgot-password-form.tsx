"use client";

import { useState } from "react";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") ?? "").trim().toLowerCase();
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      if (!res.ok) {
        setError("Unexpected error. Try again.");
      } else {
        setSent(true);
      }
    } catch {
      setError("Unexpected error. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="authForm">
        <p className="authSubtitle">
          If that email is registered, a reset link is on its way. Check
          your inbox (and spam).
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="authForm">
      <label className="authField">
        <span className="authLabel">Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          disabled={pending}
          className="authInput"
        />
      </label>
      {error ? <p className="errorLine authError">{error}</p> : null}
      <div className="authActions">
        <button type="submit" className="primaryButton" disabled={pending}>
          {pending ? "Sending…" : "Send reset link"}
        </button>
      </div>
    </form>
  );
}
