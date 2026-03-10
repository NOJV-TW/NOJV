import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ProblemWorkspace } from "@/components/problem-workspace";
import { getCoursePageData, getProblemPageData } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function ProblemDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ assessment?: string; course?: string }>;
}) {
  const { locale, slug } = await params;
  const { assessment, course } = await searchParams;
  setRequestLocale(locale);
  const tProblem = await getTranslations("problemDetail");
  const [problem, courseData] = await Promise.all([
    getProblemPageData(slug, locale),
    course ? getCoursePageData(course) : null
  ]);
  const courseContext = courseData?.course;
  const assessmentContext = assessment
    ? courseContext?.assessments.find((entry) => entry.slug === assessment)
    : undefined;
  const boundCourseSlug = courseContext?.slug ?? course ?? "course";

  if (!problem) {
    notFound();
  }

  const backLink = assessmentContext
    ? {
        href:
          assessmentContext.type === "exam"
            ? `/${locale}/courses/${boundCourseSlug}/exams/${assessmentContext.slug}`
            : `/${locale}/courses/${boundCourseSlug}/assignments/${assessmentContext.slug}`,
        label:
          assessmentContext.type === "exam"
            ? tProblem("backToExam")
            : tProblem("backToAssignment")
      }
    : undefined;

  return (
    <div className="flex h-[calc(100vh-7rem)] overflow-hidden rounded-2xl border border-[color:var(--color-border)]">
      <ProblemWorkspace
        assessment={
          assessmentContext
            ? {
                assessmentSlug: assessmentContext.slug,
                courseSlug: courseContext?.slug ?? "",
                kind: assessmentContext.type
              }
            : undefined
        }
        backLink={backLink}
        problem={problem}
      />
    </div>
  );
}
