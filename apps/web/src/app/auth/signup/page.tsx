"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const email = form.get("email") as string;
    const password = form.get("password") as string;

    const response = await fetch("/api/auth/register", {
      body: JSON.stringify({
        displayName: form.get("displayName") as string,
        email,
        handle: form.get("handle") as string,
        password
      }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.message ?? "Registration failed.");
      setLoading(false);

      return;
    }

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false
    });

    setLoading(false);

    if (result?.error) {
      setError("Account created but sign-in failed. Please sign in manually.");

      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[color:var(--color-bg)]">
      <div className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8">
        <h1 className="mb-6 text-center text-2xl font-semibold">Create your NOJV account</h1>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
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
          <Link className="text-[color:var(--color-accent)] underline" href="/auth/signin">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
