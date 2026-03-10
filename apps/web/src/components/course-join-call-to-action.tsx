"use client";

import { startTransition, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useLocale, useTranslations } from "next-intl";

import { shellClassNames } from "@nojv/ui";

import { authClient } from "@/lib/auth-client";
import { readPlatformRole } from "@/lib/auth-onboarding";
import { joinCourseMutation } from "@/lib/client/course-management-client";

interface CourseJoinCallToActionProps {
  courseSlug: string;
  courseTitle: string;
  joinMethod: "join_code" | "manual_invite" | "qr_code" | null;
  joinToken: string | null;
}

export function CourseJoinCallToAction({
  courseSlug,
  courseTitle,
  joinMethod,
  joinToken
}: CourseJoinCallToActionProps) {
  const locale = useLocale();
  const tJoin = useTranslations("courseJoin");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const platformRole = readPlatformRole(user);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    if (!joinMethod || !joinToken || joinMethod === "manual_invite") {
      setError(tJoin("incompleteLink"));
      return;
    }

    setIsJoining(true);
    setError(null);

    try {
      await joinCourseMutation({
        courseSlug,
        joinMethod,
        joinToken
      });
      startTransition(() => {
        router.push(`/${locale}/courses/${courseSlug}`);
        router.refresh();
      });
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : tJoin("joinFailed"));
    } finally {
      setIsJoining(false);
    }
  }

  return (
    <section className={`${shellClassNames.cardStrong} px-6 py-8 sm:px-8`}>
      <p className={shellClassNames.eyebrow}>{tJoin("heading")}</p>
      <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">{courseTitle}</h2>
      <p className="mt-4 max-w-2xl text-base leading-7 text-[color:var(--color-muted)]">
        {tJoin("description", { name: user?.name ?? "" })}
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className={shellClassNames.badge}>
          {joinMethod ? joinMethod.replaceAll("_", " ") : "missing join method"}
        </span>
        <span className={shellClassNames.badge}>{platformRole}</span>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          className="rounded-full bg-[color:var(--color-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={isJoining}
          onClick={() => void handleJoin()}
          type="button"
        >
          {isJoining ? tCommon("joining") : tJoin("joinButton")}
        </button>
        <Link
          className="rounded-full border border-[color:var(--color-border)] px-5 py-3 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-white/70"
          href={`/${locale}/courses/${courseSlug}`}
        >
          {tJoin("backToCourse")}
        </Link>
      </div>
      {joinToken ? (
        <p className="mt-4 text-sm text-[color:var(--color-muted)]">
          {tJoin("token")}: {joinToken}
        </p>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
    </section>
  );
}
