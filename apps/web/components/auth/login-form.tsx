"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/app/login/actions";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, {
    error: null as string | null
  });

  return (
    <form action={formAction} className="authForm">
      <input type="hidden" name="next" value={next} />
      <label className="authField">
        <span className="authLabel">Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          disabled={pending}
          className="authInput"
        />
      </label>
      <label className="authField">
        <span className="authLabel">Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          minLength={8}
          disabled={pending}
          className="authInput"
        />
      </label>
      {state?.error ? (
        <p className="errorLine authError">{state.error}</p>
      ) : null}
      <div className="authActions">
        <button
          type="submit"
          className="primaryButton"
          disabled={pending}
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </div>
      <div className="authLinks">
        <Link href="/forgot-password">Forgot password?</Link>
      </div>
    </form>
  );
}
