import Link from "next/link";
import { notFound } from "next/navigation";

import { getLocale, getTranslations } from "next-intl/server";

import { shellClassNames } from "@nojv/ui";

import {
  deriveAssessmentPresentation,
  deriveAssessmentWindowState
} from "@/lib/server/course-assessment-helpers";
import { getCoursePageData } from "@/lib/server/read-model";

export async function CourseAssessmentPage({
  params,
  type
}: {
  params: Promise<{ assessmentSlug: string; locale: string; slug: string }>;
  type: "assignment" | "exam";
}) {
  const { assessmentSlug, slug } = await params;
  const [locale, tNav, tAssessment, tCommon] = await Promise.all([
    getLocale(),
    getTranslations("navigation"),
    getTranslations("assessment"),
    getTranslations("common")
  ]);
  const courseData = await getCoursePageData(slug);
  const course = courseData?.course;
  const assessment = course?.assessments.find((entry) => entry.slug === assessmentSlug);
  const problemsBySlug = new Map(
    (courseData?.problems ?? []).map((problem) => [problem.slug, problem])
  );

  if (!course || assessment?.type !== type) {
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

  const headerContent = (
    <>
      <p className={shellClassNames.eyebrow}>
        {tNav("courses")} / {course.slug} / {type}
      </p>
      <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
        {assessment.title}
      </h2>
      <p className="mt-4 max-w-3xl text-base leading-7 text-[color:var(--color-muted)]">
        {assessment.summary}
      </p>
    </>
  );

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-8 sm:px-8`}>
        {type === "exam" ? (
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div>{headerContent}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className={`${shellClassNames.card} px-4 py-4`}>
                <p className="text-sm text-[color:var(--color-muted)]">{tAssessment("rankMode")}</p>
                <p className="mt-2 text-lg font-semibold">{assessment.scoreboardMode}</p>
              </div>
              <div className={`${shellClassNames.card} px-4 py-4`}>
                <p className="text-sm text-[color:var(--color-muted)]">{tAssessment("policy")}</p>
                <p className="mt-2 text-lg font-semibold">{tAssessment("contestGrade")}</p>
              </div>
            </div>
          </div>
        ) : (
          headerContent
        )}
      </section>

      <section
        className={`grid gap-6 ${type === "exam" ? "lg:grid-cols-[1.05fr_0.95fr]" : "lg:grid-cols-[1.1fr_0.9fr]"}`}
      >
        <div className={`${shellClassNames.card} px-6 py-6`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className={shellClassNames.eyebrow}>
                {type === "exam" ? tAssessment("examFraming") : tAssessment("assignmentFraming")}
              </p>
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
                  href={`/${locale}/problems/${problem.slug}?course=${course.slug}&assessment=${assessment.slug}`}
                  key={problem.slug}
                >
                  <div>
                    <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                      {problem.visibility}
                    </p>
                    <p className="mt-1 text-lg font-semibold">{problem.title}</p>
                  </div>
                  <span className={shellClassNames.badge}>
                    {type === "exam" ? tAssessment("examEditor") : tAssessment("openInEditor")}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        <aside className="space-y-6">
          {type === "exam" ? (
            <section className={`${shellClassNames.card} px-5 py-5`}>
              <p className={shellClassNames.eyebrow}>{tAssessment("liveRank")}</p>
              <p className="mt-4 text-sm text-[color:var(--color-muted)]">
                {tAssessment("rankNotAvailable", { default: "Leaderboard not yet available." })}
              </p>
            </section>
          ) : (
            <section className={`${shellClassNames.card} px-5 py-5`}>
              <p className={shellClassNames.eyebrow}>{tCommon("timeline")}</p>
              <div className="mt-4 space-y-3 text-sm leading-7 text-[color:var(--color-muted)]">
                <p>{tAssessment("opens")}: {assessment.opensAt}</p>
                <p>{tAssessment("due")}: {assessment.dueAt}</p>
                <p>{tAssessment("closes")}: {assessment.closesAt}</p>
              </div>
            </section>
          )}
          <section className={`${shellClassNames.card} px-5 py-5`}>
            <p className={shellClassNames.eyebrow}>{tAssessment("whyDiffers")}</p>
            <p className="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">
              {type === "exam"
                ? tAssessment("examExplanation")
                : tAssessment("assignmentExplanation")}
            </p>
          </section>
        </aside>
      </section>
    </div>
  );
}
