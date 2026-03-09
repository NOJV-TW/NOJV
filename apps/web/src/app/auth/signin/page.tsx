"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);

    const { error: signInError } = await authClient.signIn.email({
      email: form.get("email") as string,
      password: form.get("password") as string
    });

    setLoading(false);

    if (signInError) {
      setError(signInError.message ?? "Invalid email or password.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  async function handleOAuth(provider: "github" | "google") {
    await authClient.signIn.social({ callbackURL: "/", provider });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[color:var(--color-bg)]">
      <div className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8">
        <h1 className="mb-6 text-center text-2xl font-semibold">Sign in to NOJV</h1>

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
              autoComplete="current-password"
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
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
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-[color:var(--color-muted)]">
          Don&apos;t have an account?{" "}
          <Link className="text-[color:var(--color-accent)] underline" href="/auth/signup">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
