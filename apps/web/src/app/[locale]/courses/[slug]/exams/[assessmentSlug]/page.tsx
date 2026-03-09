import Link from "next/link";
import { notFound } from "next/navigation";

import { getCopy, isLocale } from "@nojv/i18n";
import { shellClassNames } from "@nojv/ui";

import {
  deriveAssessmentPresentation,
  deriveAssessmentWindowState
} from "@/lib/server/course-poc-helpers";
import { getCoursePageData } from "@/lib/server/read-model";

const examLeaderboard = [
  { name: "Alice Huang", penalty: 420, rank: 1, solved: 2 },
  { name: "Bob Lin", penalty: 510, rank: 2, solved: 2 },
  { name: "Maya Su", penalty: 900, rank: 3, solved: 1 }
] as const;

export const dynamic = "force-dynamic";

export default async function CourseExamPage({
  params
}: {
  params: Promise<{ assessmentSlug: string; locale: string; slug: string }>;
}) {
  const { assessmentSlug, locale, slug } = await params;
  const currentLocale = isLocale(locale) ? locale : "zh-TW";
  const labels = getCopy(currentLocale);
  const courseData = await getCoursePageData(slug);
  const course = courseData?.course;
  const assessment = course?.assessments.find((entry) => entry.slug === assessmentSlug);
  const problemsBySlug = new Map(
    (courseData?.problems ?? []).map((problem) => [problem.slug, problem])
  );

  if (!course || assessment?.type !== "exam") {
    notFound();
  }

  const presentation = deriveAssessmentPresentation({
    scoreboardMode: assessment.scoreboardMode,
    type: assessment.type
  });
  const windowState = deriveAssessmentWindowState({
    closesAt: assessment.closesAt,
    dueAt: assessment.dueAt,
    opensAt: assessment.opensAt
  });

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-8 sm:px-8`}>
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className={shellClassNames.eyebrow}>
              {labels.navigation.courses} / {course.slug} / exam
            </p>
            <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
              {assessment.title}
            </h2>
            <p className="mt-4 max-w-3xl text-base leading-7 text-[color:var(--color-muted)]">
              {assessment.summary}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={`${shellClassNames.card} px-4 py-4`}>
              <p className="text-sm text-[color:var(--color-muted)]">Rank mode</p>
              <p className="mt-2 text-lg font-semibold">{assessment.scoreboardMode}</p>
            </div>
            <div className={`${shellClassNames.card} px-4 py-4`}>
              <p className="text-sm text-[color:var(--color-muted)]">Policy</p>
              <p className="mt-2 text-lg font-semibold">contest-grade</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className={`${shellClassNames.card} px-6 py-6`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className={shellClassNames.eyebrow}>Exam framing</p>
              <h3 className={shellClassNames.sectionTitle}>{presentation.heroLabel}</h3>
            </div>
            <span className={shellClassNames.badge}>{windowState}</span>
          </div>
          <div className="mt-5 space-y-3">
            {assessment.problemSlugs.map((problemSlug) => {
              const problem = problemsBySlug.get(problemSlug);

              if (!problem) {
                return null;
              }

              return (
                <Link
                  className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4 transition hover:-translate-y-0.5"
                  href={`/${currentLocale}/problems/${problem.slug}?course=${course.slug}&assessment=${assessment.slug}`}
                  key={problem.slug}
                >
                  <div>
                    <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                      {problem.visibility}
                    </p>
                    <p className="mt-1 text-lg font-semibold">{problem.title}</p>
                  </div>
                  <span className={shellClassNames.badge}>exam editor</span>
                </Link>
              );
            })}
          </div>
        </div>

        <aside className="space-y-6">
          <section className={`${shellClassNames.card} px-5 py-5`}>
            <p className={shellClassNames.eyebrow}>Live rank</p>
            <div className="mt-4 space-y-3">
              {examLeaderboard.map((entry) => (
                <div
                  className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
                  key={entry.rank}
                >
                  <div>
                    <p className="font-semibold">{entry.name}</p>
                    <p className="mt-1 text-sm text-[color:var(--color-muted)]">
                      {entry.solved} solved
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold">#{entry.rank}</p>
                    <p className="mt-1 text-sm text-[color:var(--color-muted)]">
                      {entry.penalty} sec
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className={`${shellClassNames.card} px-5 py-5`}>
            <p className={shellClassNames.eyebrow}>Why this page differs</p>
            <p className="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">
              Exams inherit contest-style urgency: tighter workspace policy, rank visibility,
              and a stronger relationship between telemetry and reviewer escalation.
            </p>
          </section>
        </aside>
      </section>
    </div>
  );
}
