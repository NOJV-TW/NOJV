import Link from "next/link";

import { getCopy, isLocale } from "@nojv/i18n";
import { formatAcceptanceRate, shellClassNames } from "@nojv/ui";

import { listCourseCards, listProblemCards } from "@/lib/server/read-model";
import { resolveWorkspaceAppUrl } from "@/lib/workspace-launch";

export const dynamic = "force-dynamic";

export default async function LocaleHomePage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const currentLocale = isLocale(locale) ? locale : "zh-TW";
  const labels = getCopy(currentLocale);
  const courses = await listCourseCards();
  const problems = await listProblemCards();
  const workspaceAppUrl = resolveWorkspaceAppUrl();

  return (
    <div className="space-y-6">
      <section
        className={`${shellClassNames.cardStrong} animate-[fade-up_700ms_cubic-bezier(0.22,1,0.36,1)_both] px-6 py-8 sm:px-8`}
      >
        <p className={shellClassNames.eyebrow}>{labels.hero.eyebrow}</p>
        <h2 className="mt-2 max-w-3xl font-[family-name:var(--font-display)] text-4xl leading-tight sm:text-5xl">
          {labels.hero.title}
        </h2>
        <p className="mt-3 max-w-2xl text-base leading-7 text-[color:var(--color-muted)]">
          {labels.hero.subtitle}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            className="rounded-full bg-[color:var(--color-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5"
            href={`/${currentLocale}/problems`}
          >
            {labels.navigation.problems}
          </Link>
          <Link
            className="rounded-full border border-[color:var(--color-border)] px-5 py-3 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-white/70"
            href={workspaceAppUrl}
            target="_blank"
          >
            {labels.navigation.workspace}
          </Link>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className={`${shellClassNames.card} px-6 py-6`}>
          <div className="flex items-center justify-between">
            <h3 className={shellClassNames.sectionTitle}>{labels.navigation.problems}</h3>
            <Link className={shellClassNames.badge} href={`/${currentLocale}/problems`}>
              Browse
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {problems.map((problem) => (
              <Link
                className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/60 px-4 py-4 transition hover:-translate-y-0.5"
                href={`/${currentLocale}/problems/${problem.slug}`}
                key={problem.slug}
              >
                <div>
                  <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                    {problem.difficulty}
                  </p>
                  <p className="mt-1 text-lg font-semibold">{problem.title}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-[color:var(--color-muted)]">Acceptance</p>
                  <p className="text-lg font-semibold">
                    {formatAcceptanceRate(problem.acceptanceRate)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
        <div className={`${shellClassNames.card} px-6 py-6`}>
          <div className="flex items-center justify-between">
            <h3 className={shellClassNames.sectionTitle}>{labels.navigation.contests}</h3>
            <Link className={shellClassNames.badge} href={`/${currentLocale}/contests`}>
              Enter
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            <p className="text-sm text-[color:var(--color-muted)]">
              Visit the contests page to see upcoming and past contests.
            </p>
          </div>
        </div>
        <div className={`${shellClassNames.card} px-6 py-6`}>
          <div className="flex items-center justify-between">
            <h3 className={shellClassNames.sectionTitle}>{labels.navigation.courses}</h3>
            <Link className={shellClassNames.badge} href={`/${currentLocale}/courses`}>
              Enter
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {courses.map((course) => (
              <Link
                className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/60 px-4 py-4 transition hover:-translate-y-0.5 block"
                href={`/${currentLocale}/courses/${course.slug}`}
                key={course.slug}
              >
                <p className="text-lg font-semibold">{course.title}</p>
                <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                  {course.memberCount} members / {course.assessmentCount} assessments
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
