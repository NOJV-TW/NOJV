import Link from "next/link";
import { notFound } from "next/navigation";

import { getCopy, isLocale } from "@nojv/i18n";
import { shellClassNames } from "@nojv/ui";

import {
  deriveAssessmentPresentation,
  deriveAssessmentWindowState
} from "@/lib/server/course-poc-helpers";
import { getCoursePageData } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function CourseAssignmentPage({
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

  if (!course || assessment?.type !== "assignment") {
    notFound();
  }

  const presentation = deriveAssessmentPresentation({
    scoreboardMode: assessment.scoreboardMode,
    type: assessment.type
  });
  const windowState = deriveAssessmentWindowState({
    closesAt: assessment.closesAt,
    dueAt: assessment.dueAt,
    now: new Date().toISOString(),
    opensAt: assessment.opensAt
  });

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-8 sm:px-8`}>
        <p className={shellClassNames.eyebrow}>
          {labels.navigation.courses} / {course.slug} / assignment
        </p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
          {assessment.title}
        </h2>
        <p className="mt-4 max-w-3xl text-base leading-7 text-[color:var(--color-muted)]">
          {assessment.summary}
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className={`${shellClassNames.card} px-6 py-6`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className={shellClassNames.eyebrow}>Assignment framing</p>
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
                  <span className={shellClassNames.badge}>open in editor</span>
                </Link>
              );
            })}
          </div>
        </div>

        <aside className="space-y-6">
          <section className={`${shellClassNames.card} px-5 py-5`}>
            <p className={shellClassNames.eyebrow}>Timeline</p>
            <div className="mt-4 space-y-3 text-sm leading-7 text-[color:var(--color-muted)]">
              <p>Opens: {assessment.opensAt}</p>
              <p>Due: {assessment.dueAt}</p>
              <p>Closes: {assessment.closesAt}</p>
            </div>
          </section>
          <section className={`${shellClassNames.card} px-5 py-5`}>
            <p className={shellClassNames.eyebrow}>Why this page differs</p>
            <p className="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">
              Assignments emphasize deadlines, progress, and course context. They still submit
              through the judge, but the UI avoids contest-rank pressure.
            </p>
          </section>
        </aside>
      </section>
    </div>
  );
}
