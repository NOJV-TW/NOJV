"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const result = await signIn("credentials", {
      email: form.get("email") as string,
      password: form.get("password") as string,
      redirect: false
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password.");

      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[color:var(--color-bg)]">
      <div className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8">
        <h1 className="mb-6 text-center text-2xl font-semibold">Sign in to NOJV</h1>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
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
