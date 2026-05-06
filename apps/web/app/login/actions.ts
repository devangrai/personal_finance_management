"use server";

import { signIn, signOut } from "@/lib/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

/**
 * Server action for the login form. Uses NextAuth's signIn() server-side
 * so the session cookie is set before the redirect response.
 *
 * Returns a string error message on failure (consumed by the client
 * component via useActionState), or redirects on success.
 */
export async function loginAction(
  _prevState: { error: string | null } | null,
  formData: FormData
): Promise<{ error: string | null }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/overview");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: next
    });
    // signIn throws a NEXT_REDIRECT on success; unreachable below.
    return { error: null };
  } catch (e) {
    // NextAuth's redirect throws are fine — let them bubble.
    if ((e as { message?: string }).message === "NEXT_REDIRECT") {
      throw e;
    }
    if (e instanceof AuthError) {
      // "CredentialsSignin" is the generic bad-password error.
      if (e.type === "CredentialsSignin") {
        return { error: "Incorrect email or password." };
      }
      return { error: "Sign-in failed. Try again." };
    }
    return { error: "Unexpected error. Try again." };
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
  redirect("/login");
}
