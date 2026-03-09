"use client";

import Link from "next/link";

import { useTranslations } from "next-intl";

import { shellClassNames } from "@nojv/ui";

import { authClient } from "@/lib/auth-client";

export function UserAuthMenu() {
  const t = useTranslations("auth");
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <div className="rounded-full border border-[color:var(--color-border)] bg-white/60 px-4 py-2 text-sm text-[color:var(--color-muted)]">
        ...
      </div>
    );
  }

  if (session?.user) {
    return (
      <div className="flex items-center gap-2">
        <span className={`${shellClassNames.badge} max-w-[10rem] truncate`}>
          {session.user.name ?? session.user.email}
        </span>
        <button
          className="rounded-full border border-[color:var(--color-border)] px-3 py-1.5 text-sm transition hover:-translate-y-0.5 hover:bg-white/70"
          onClick={() => void authClient.signOut()}
          type="button"
        >
          {t("signOut")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <Link
        className="rounded-full border border-[color:var(--color-border)] px-4 py-2 transition hover:-translate-y-0.5 hover:bg-white/70"
        href="/auth/signin"
      >
        {t("signIn")}
      </Link>
      <Link
        className="rounded-full bg-[color:var(--color-accent)] px-4 py-2 text-white transition hover:-translate-y-0.5"
        href="/auth/signup"
      >
        {t("signUp")}
      </Link>
    </div>
  );
}
