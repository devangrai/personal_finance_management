"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

type Props = {
  initialCode?: string;
  initialEmail?: string;
};

export function SignupForm(props: Props) {
  const router = useRouter();
  const [email, setEmail] = useState(props.initialEmail ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code] = useState(props.initialCode ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Client-side password validation. The server also enforces length
  // (>= 8) as a defense in depth.
  const passwordLongEnough = password.length >= 8;
  const passwordsMatch =
    password.length > 0 && confirmPassword.length > 0 && password === confirmPassword;
  const passwordsFilled = password.length > 0 && confirmPassword.length > 0;
  const formValid = Boolean(
    email && code && passwordLongEnough && passwordsMatch
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formValid || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          displayName,
          inviteCode: code
        })
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Signup failed.");
      }

      // Account created. Auto-sign-in so the user lands on /overview
      // without typing their password again. NextAuth's credentials
      // provider expects the same shape as /login submits.
      const signInResult = await signIn("credentials", {
        email,
        password,
        redirect: false
      });
      if (signInResult?.error) {
        // Extremely unlikely since we just created the account, but if
        // it happens, send them to /login with a pre-filled hint so they
        // can sign in manually.
        router.push(`/login?email=${encodeURIComponent(email)}`);
        return;
      }
      router.push("/overview");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signup failed.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="authForm">
      <label className="authField">
        <span className="authLabel">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
          className="authInput"
        />
      </label>
      <label className="authField">
        <span className="authLabel">Display name (optional)</span>
        <input
          type="text"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          disabled={pending}
          className="authInput"
          maxLength={80}
        />
      </label>
      <label className="authField">
        <span className="authLabel">
          Password{" "}
          <em className="muted">(at least 8 characters)</em>
        </span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
          className="authInput"
        />
      </label>
      <label className="authField">
        <span className="authLabel">
          Confirm password{" "}
          {passwordsFilled ? (
            passwordsMatch ? (
              <em className="passwordMatch passwordMatch--ok">✓ match</em>
            ) : (
              <em className="passwordMatch passwordMatch--bad">✗ don&apos;t match</em>
            )
          ) : null}
        </span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={pending}
          className="authInput"
        />
      </label>
      {!code ? (
        <p className="errorLine authError">
          Invite code missing from the URL. Ask whoever invited you for a
          fresh link.
        </p>
      ) : null}
      {error ? <p className="errorLine authError">{error}</p> : null}
      <div className="authActions">
        <button
          type="submit"
          className="primaryButton"
          disabled={pending || !formValid}
        >
          {pending ? "Creating account…" : "Create account"}
        </button>
      </div>
    </form>
  );
}
