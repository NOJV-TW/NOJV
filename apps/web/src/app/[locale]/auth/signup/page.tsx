"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale } from "next-intl";

import { authClient } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const locale = useLocale();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);

    const { error: signUpError } = await authClient.signUp.email({
      email: form.get("email") as string,
      name: form.get("displayName") as string,
      password: form.get("password") as string,
      username: form.get("handle") as string
    });

    setLoading(false);

    if (signUpError) {
      setError(signUpError.message ?? "Registration failed.");
      return;
    }

    router.push(`/${locale}`);
    router.refresh();
  }

  async function handleOAuth(provider: "github" | "google") {
    await authClient.signIn.social({ callbackURL: `/${locale}`, provider });
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8">
        <h1 className="mb-6 text-center text-2xl font-semibold">Create your NOJV account</h1>

        <div className="flex flex-col gap-3">
          <button
            className="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
            onClick={() => void handleOAuth("github")}
            type="button"
          >
            GitHub
          </button>
          <button
            className="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
            onClick={() => void handleOAuth("google")}
            type="button"
          >
            Google
          </button>
        </div>

        <div className="my-5 flex items-center gap-3 text-xs text-[color:var(--color-muted)]">
          <hr className="flex-1 border-[color:var(--color-border)]" />
          or
          <hr className="flex-1 border-[color:var(--color-border)]" />
        </div>

        <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
          <label className="flex flex-col gap-1 text-sm">
            Display name
            <input
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
              name="displayName"
              required
              type="text"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Handle
            <input
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
              name="handle"
              pattern="[a-z0-9._-]{3,64}"
              required
              title="3-64 characters, lowercase letters, digits, dots, hyphens, underscores"
              type="text"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              autoComplete="email"
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
              name="email"
              required
              type="email"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Password
            <input
              autoComplete="new-password"
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            className="rounded-lg bg-[color:var(--color-accent)] py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={loading}
            type="submit"
          >
            {loading ? "Creating account..." : "Sign up"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-[color:var(--color-muted)]">
          Already have an account?{" "}
          <Link
            className="text-[color:var(--color-accent)] underline"
            href={`/${locale}/auth/signin`}
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
