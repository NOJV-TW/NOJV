import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { formatAcceptanceRate, shellClassNames } from "@nojv/ui";

import {
  getDashboardStats,
  listContestCards,
  listCourseCards,
  listProblemCards
} from "@/lib/server/read-model";
import { resolveWorkspaceAppUrl } from "@/lib/workspace-launch";

export const dynamic = "force-dynamic";

export default async function LocaleHomePage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [tHero, tNav, tCommon] = await Promise.all([
    getTranslations("hero"),
    getTranslations("navigation"),
    getTranslations("common")
  ]);
  const [courses, problems, contests, stats] = await Promise.all([
    listCourseCards(),
    listProblemCards(),
    listContestCards(),
    getDashboardStats()
  ]);
  const workspaceAppUrl = resolveWorkspaceAppUrl();

  return (
    <div className="space-y-6">
      <section
        className={`${shellClassNames.cardStrong} animate-[fade-up_700ms_cubic-bezier(0.22,1,0.36,1)_both] px-6 py-8 sm:px-8`}
      >
        <p className={shellClassNames.eyebrow}>{tHero('eyebrow')}</p>
        <h2 className="mt-2 max-w-3xl font-[family-name:var(--font-display)] text-4xl leading-tight sm:text-5xl">
          {tHero('title')}
        </h2>
        <p className="mt-3 max-w-2xl text-base leading-7 text-[color:var(--color-muted)]">
          {tHero('subtitle')}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            className="rounded-full bg-[color:var(--color-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5"
            href={`/${locale}/problems`}
          >
            {tNav('problems')}
          </Link>
          <Link
            className="rounded-full border border-[color:var(--color-border)] px-5 py-3 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-white/70"
            href={workspaceAppUrl}
            target="_blank"
          >
            {tNav('workspace')}
          </Link>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className={`${shellClassNames.card} px-5 py-4`}>
            <p className={shellClassNames.eyebrow}>{tNav('problems')}</p>
            <p className={shellClassNames.metricValue}>{stats.problems}</p>
          </div>
          <div className={`${shellClassNames.card} px-5 py-4`}>
            <p className={shellClassNames.eyebrow}>{tNav('submissions')}</p>
            <p className={shellClassNames.metricValue}>{stats.submissions}</p>
          </div>
          <div className={`${shellClassNames.card} px-5 py-4`}>
            <p className={shellClassNames.eyebrow}>{tNav('courses')}</p>
            <p className={shellClassNames.metricValue}>{stats.courses}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className={`${shellClassNames.card} px-6 py-6`}>
          <div className="flex items-center justify-between">
            <h3 className={shellClassNames.sectionTitle}>{tNav('problems')}</h3>
            <Link className={shellClassNames.badge} href={`/${locale}/problems`}>
              {tCommon('browse')}
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {problems.map((problem) => (
              <Link
                className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/60 px-4 py-4 transition hover:-translate-y-0.5"
                href={`/${locale}/problems/${problem.slug}`}
                key={problem.slug}
              >
                <div>
                  <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                    {problem.difficulty}
                  </p>
                  <p className="mt-1 text-lg font-semibold">{problem.title}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-[color:var(--color-muted)]">{tCommon('acceptance')}</p>
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
            <h3 className={shellClassNames.sectionTitle}>{tNav('contests')}</h3>
            <Link className={shellClassNames.badge} href={`/${locale}/contests`}>
              {tCommon('enter')}
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {contests.map((contest) => (
              <Link
                className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/60 px-4 py-4 block transition hover:-translate-y-0.5"
                href={`/${locale}/contests/${contest.slug}`}
                key={contest.slug}
              >
                <p className="text-lg font-semibold">{contest.title}</p>
                <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                  {new Date(contest.startsAt).toLocaleDateString()} &mdash;{" "}
                  {new Date(contest.endsAt).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        </div>
        <div className={`${shellClassNames.card} px-6 py-6`}>
          <div className="flex items-center justify-between">
            <h3 className={shellClassNames.sectionTitle}>{tNav('courses')}</h3>
            <Link className={shellClassNames.badge} href={`/${locale}/courses`}>
              {tCommon('enter')}
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {courses.map((course) => (
              <Link
                className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/60 px-4 py-4 transition hover:-translate-y-0.5 block"
                href={`/${locale}/courses/${course.slug}`}
                key={course.slug}
              >
                <p className="text-lg font-semibold">{course.title}</p>
                <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                  {course.memberCount} {tCommon('members')} / {course.assessmentCount} {tCommon('assessments')}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
