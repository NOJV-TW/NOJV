"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const locale = useLocale();
  const t = useTranslations("auth");

  async function handleOAuth(provider: "github" | "google") {
    await authClient.signIn.social({ callbackURL: `/${locale}`, provider });
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8">
        <h1 className="mb-6 text-center text-2xl font-semibold">{t("signInTitle")}</h1>

        <div className="flex flex-col gap-3">
          <button
            className="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--color-border)] py-2.5 text-sm font-medium transition hover:bg-white/70"
            onClick={() => void handleOAuth("github")}
            type="button"
          >
            GitHub
          </button>
          <button
            className="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--color-border)] py-2.5 text-sm font-medium transition hover:bg-white/70"
            onClick={() => void handleOAuth("google")}
            type="button"
          >
            Google
          </button>
        </div>

        <div className="mt-6 text-center">
          <Link
            className="text-xs text-[color:var(--color-muted)] underline transition hover:text-[color:var(--color-ink)]"
            href={`/${locale}/auth/admin-signin`}
          >
            {t("adminSignIn")}
          </Link>
        </div>
      </div>
    </div>
  );
}
