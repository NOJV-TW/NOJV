import Link from "next/link";

import { getLocale, getTranslations } from "next-intl/server";

import { shellClassNames } from "@nojv/ui";

import type { CoursePocAssessment } from "@/lib/server/read-model";
import {
  deriveAssessmentPresentation,
  deriveAssessmentWindowState
} from "@/lib/server/course-poc-helpers";

interface CourseAssessmentBoardProps {
  assessments: CoursePocAssessment[];
  courseSlug: string;
}

export async function CourseAssessmentBoard({
  assessments,
  courseSlug
}: CourseAssessmentBoardProps) {
  const [locale, tCourse, tCommon, tContest] = await Promise.all([
    getLocale(),
    getTranslations("courseDetail"),
    getTranslations("common"),
    getTranslations("contestDetail")
  ]);
  return (
    <section className={`${shellClassNames.card} px-5 py-5`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className={shellClassNames.eyebrow}>{tCourse("assessmentBoard")}</p>
          <h3 className="mt-1 text-2xl font-semibold">{tCourse("assessmentBoardSubtitle")}</h3>
        </div>
        <span className={shellClassNames.badge}>{assessments.length} {tCommon("assessments")}</span>
      </div>
      <div className="mt-5 grid gap-4">
        {assessments.map((assessment) => {
          const presentation = deriveAssessmentPresentation({
            scoreboardMode: assessment.scoreboardMode,
            type: assessment.type
          });
          const windowState = deriveAssessmentWindowState({
            closesAt: assessment.closesAt,
            dueAt: assessment.dueAt,
            opensAt: assessment.opensAt
          });
          const href =
            assessment.type === "exam"
              ? `/${locale}/courses/${courseSlug}/exams/${assessment.slug}`
              : `/${locale}/courses/${courseSlug}/assignments/${assessment.slug}`;

          return (
            <Link
              className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4 transition hover:-translate-y-0.5"
              href={href}
              key={assessment.slug}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                    {assessment.type}
                  </p>
                  <p className="mt-2 text-lg font-semibold">{assessment.title}</p>
                  <p className="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">
                    {assessment.summary}
                  </p>
                </div>
                <div className="text-right">
                  <span className={shellClassNames.badge}>{windowState}</span>
                  <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                    {assessment.problemSlugs.length} {tContest("problems")}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-[color:var(--color-muted)]">{tCourse("framing")}</p>
                  <p className="mt-1 font-semibold">{presentation.heroLabel}</p>
                </div>
                <div>
                  <p className="text-sm text-[color:var(--color-muted)]">{tCourse("window")}</p>
                  <p className="mt-1 font-semibold">
                    {assessment.opensAt.slice(0, 10)} → {assessment.closesAt.slice(0, 10)}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
