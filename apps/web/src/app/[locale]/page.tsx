import Link from "next/link";

import { getCopy, isLocale } from "@nojv/i18n";
import { formatAcceptanceRate, shellClassNames } from "@nojv/ui";

import { MetricTrendChart } from "@/components/metric-trend-chart";
import { contestCards, integrityCases, queueSeries } from "@/lib/demo-data";
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
        className={`${shellClassNames.cardStrong} animate-[fade-up_700ms_cubic-bezier(0.22,1,0.36,1)_both] overflow-hidden px-6 py-8 sm:px-8`}
      >
        <div className="grid gap-8 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="space-y-5">
            <p className={shellClassNames.eyebrow}>{labels.hero.eyebrow}</p>
            <h2 className="max-w-3xl font-[family-name:var(--font-display)] text-5xl leading-[1.02] sm:text-6xl">
              {labels.hero.title}
            </h2>
            <p className="max-w-2xl text-base leading-7 text-[color:var(--color-muted)] sm:text-lg">
              {labels.hero.subtitle}
            </p>
            <div className="flex flex-wrap gap-3">
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
          </div>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            <div className={`${shellClassNames.card} px-5 py-5`}>
              <p className={shellClassNames.eyebrow}>Queues / min</p>
              <p className={shellClassNames.metricValue}>149</p>
              <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                submission + workspace + integrity events
              </p>
            </div>
            <div className={`${shellClassNames.card} px-5 py-5`}>
              <p className={shellClassNames.eyebrow}>Course zones</p>
              <p className={shellClassNames.metricValue}>{courses.length}</p>
              <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                teacher-owned RBAC, assignments, exams, and enrollment flows
              </p>
            </div>
            <div className={`${shellClassNames.card} px-5 py-5`}>
              <p className={shellClassNames.eyebrow}>Isolation</p>
              <p className={shellClassNames.metricValue}>Docker</p>
              <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                makefile, shell, and submission execution leave the web tier
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
        <div className={`${shellClassNames.card} px-6 py-6`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={shellClassNames.eyebrow}>Execution Backbone</p>
              <h3 className={shellClassNames.sectionTitle}>
                Queue health across product zones
              </h3>
            </div>
            <span className={shellClassNames.badge}>BullMQ + Redis</span>
          </div>
          <div className="mt-6">
            <MetricTrendChart {...queueSeries} />
          </div>
        </div>
        <div className="space-y-6">
          <div className={`${shellClassNames.card} px-6 py-6`}>
            <p className={shellClassNames.eyebrow}>Architecture</p>
            <h3 className="mt-2 font-[family-name:var(--font-display)] text-2xl">
              Next.js for the platform, Vite for the IDE, worker for the judge.
            </h3>
            <p className="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">
              The web app owns discovery, problems, contests, and integrity dashboards. The
              workspace app owns terminal-grade interaction. The worker owns scoring, execution,
              and anti-cheat aggregation.
            </p>
          </div>
          <div className={`${shellClassNames.card} px-6 py-6`}>
            <p className={shellClassNames.eyebrow}>{labels.integrity.heading}</p>
            <h3 className="mt-2 font-[family-name:var(--font-display)] text-2xl">
              Evidence-first reviewer pipeline
            </h3>
            <p className="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">
              {labels.integrity.subtitle}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className={`${shellClassNames.card} px-6 py-6`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={shellClassNames.eyebrow}>Problem Zone</p>
              <h3 className={shellClassNames.sectionTitle}>Practice catalog</h3>
            </div>
            <Link className={shellClassNames.badge} href={`/${currentLocale}/problems`}>
              Browse
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {problems.map((problem) => (
              <div
                className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/60 px-4 py-4"
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
              </div>
            ))}
          </div>
        </div>
        <div className={`${shellClassNames.card} px-6 py-6`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={shellClassNames.eyebrow}>Contest Zone</p>
              <h3 className={shellClassNames.sectionTitle}>Isolated competitive surfaces</h3>
            </div>
            <Link className={shellClassNames.badge} href={`/${currentLocale}/contests`}>
              Enter
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {contestCards.map((contest) => (
              <div
                className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/60 px-4 py-4"
                key={contest.slug}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                      {contest.mode}
                    </p>
                    <p className="mt-1 text-lg font-semibold">{contest.title}</p>
                  </div>
                  <span className={shellClassNames.badge}>freeze aware</span>
                </div>
                <p className="mt-4 text-sm text-[color:var(--color-muted)]">
                  {contest.startsAt} → {contest.endsAt}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className={`${shellClassNames.card} px-6 py-6`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={shellClassNames.eyebrow}>Course Zone</p>
              <h3 className={shellClassNames.sectionTitle}>Managed classrooms</h3>
            </div>
            <Link className={shellClassNames.badge} href={`/${currentLocale}/courses`}>
              Enter
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {courses.map((course) => (
              <div
                className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/60 px-4 py-4"
                key={course.slug}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                      course management
                    </p>
                    <p className="mt-1 text-lg font-semibold">{course.title}</p>
                  </div>
                  <span className={shellClassNames.badge}>{course.memberCount} seats</span>
                </div>
                <p className="mt-4 text-sm text-[color:var(--color-muted)]">
                  {course.assessmentCount} assignments / exams connected to the shared judge
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={`${shellClassNames.card} px-6 py-6`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className={shellClassNames.eyebrow}>Integrity Review</p>
            <h3 className={shellClassNames.sectionTitle}>Top flagged cases</h3>
          </div>
          <Link className={shellClassNames.badge} href={`/${currentLocale}/integrity`}>
            Reviewer desk
          </Link>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {integrityCases.map((item) => (
            <div
              className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/60 px-4 py-4"
              key={item.caseId}
            >
              <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                {item.state.replaceAll("_", " ")}
              </p>
              <p className="mt-2 text-lg font-semibold">{item.userId}</p>
              <p className="mt-4 text-sm text-[color:var(--color-muted)]">
                score {item.score} / {item.signalCount} signals
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
