"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("auth");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const identity = (form.get("identity") as string).trim();
    const password = form.get("password") as string;

    const isEmail = identity.includes("@");
    const { error: signInError } = isEmail
      ? await authClient.signIn.email({ email: identity, password })
      : await authClient.signIn.username({ username: identity, password });

    setLoading(false);

    if (signInError) {
      setError(signInError.message ?? t("invalidCredentials"));
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
        <h1 className="mb-6 text-center text-2xl font-semibold">{t("signInTitle")}</h1>

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
          {t("or")}
          <hr className="flex-1 border-[color:var(--color-border)]" />
        </div>

        <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
          <label className="flex flex-col gap-1 text-sm">
            {t("emailOrHandle")}
            <input
              autoComplete="username"
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
              name="identity"
              required
              type="text"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("password")}
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
            {loading ? t("signingIn") : t("signIn")}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-[color:var(--color-muted)]">
          {t("noAccount")}{" "}
          <Link
            className="text-[color:var(--color-accent)] underline"
            href={`/${locale}/auth/signup`}
          >
            {t("signUp")}
          </Link>
        </p>
      </div>
    </div>
  );
}
