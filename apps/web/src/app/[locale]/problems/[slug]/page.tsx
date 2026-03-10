import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { shellClassNames } from "@nojv/ui";

import { ProblemEditor } from "@/components/problem-editor";
import { ProblemTestcasePanel } from "@/components/problem-testcase-panel";
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
  const [tNav, tCommon, tProblem] = await Promise.all([
    getTranslations("navigation"),
    getTranslations("common"),
    getTranslations("problemDetail")
  ]);
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

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-8 sm:px-8`}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className={shellClassNames.eyebrow}>
              {tNav('problems')} / {problem.slug}
            </p>
            <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
              {problem.title}
            </h2>
            <p className="mt-4 text-base leading-7 text-[color:var(--color-muted)]">
              {problem.statement}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <div className={`${shellClassNames.card} px-4 py-4`}>
              <p className="text-sm text-[color:var(--color-muted)]">{tCommon('difficulty')}</p>
              <p className="mt-2 text-lg font-semibold capitalize">{problem.difficulty}</p>
            </div>
            <div className={`${shellClassNames.card} px-4 py-4`}>
              <p className="text-sm text-[color:var(--color-muted)]">{tCommon('acceptance')}</p>
              <p className="mt-2 text-lg font-semibold">
                {Math.round(problem.acceptanceRate * 100)}%
              </p>
            </div>
            <div className={`${shellClassNames.card} px-4 py-4`}>
              <p className="text-sm text-[color:var(--color-muted)]">{tProblem('context')}</p>
              <p className="mt-2 text-lg font-semibold">
                {assessmentContext
                  ? `${courseContext?.title ?? tProblem('course')} / ${assessmentContext.title}`
                  : courseContext
                    ? courseContext.title
                    : tProblem('practiceCatalog')}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className={`${shellClassNames.card} px-6 py-6`}>
          <p className={shellClassNames.eyebrow}>{tProblem('brief')}</p>
          <p className="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">
            {problem.summary}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {problem.tags.map((tag) => (
              <span className={shellClassNames.badge} key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <div className="mt-6 space-y-4">
            {problem.samples.map((sample, index) => (
              <article
                className="rounded-[1.5rem] border border-[color:var(--color-border)] bg-white/70 px-4 py-4"
                key={[problem.slug, String(index)].join("-")}
              >
                <p className="text-sm font-semibold">{tProblem('sample')} {index + 1}</p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-2xl bg-stone-900/95 px-3 py-3 text-xs leading-6 text-stone-100">
                  {tProblem('input')}
                  {"\n"}
                  {sample.input}
                  {"\n\n"}
                  {tProblem('output')}
                  {"\n"}
                  {sample.output}
                </pre>
                <p className="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">
                  {sample.explanation}
                </p>
              </article>
            ))}
          </div>
        </div>

        <section className="space-y-4">
          {assessmentContext ? (
            <div className={`${shellClassNames.card} px-5 py-5`}>
              <p className={shellClassNames.eyebrow}>{tProblem('course')}</p>
              <p className="mt-2 text-lg font-semibold">{assessmentContext.title}</p>
              <Link
                className="mt-3 inline-flex rounded-full border border-[color:var(--color-border)] px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-white/70"
                href={
                  assessmentContext.type === "exam"
                    ? `/${locale}/courses/${boundCourseSlug}/exams/${assessmentContext.slug}`
                    : `/${locale}/courses/${boundCourseSlug}/assignments/${assessmentContext.slug}`
                }
              >
                {assessmentContext.type === "exam" ? tProblem('backToExam') : tProblem('backToAssignment')}
              </Link>
            </div>
          ) : null}

          <ProblemEditor
            assessment={
              assessmentContext
                ? {
                    assessmentSlug: assessmentContext.slug,
                    courseSlug: courseContext?.slug ?? "",
                    kind: assessmentContext.type
                  }
                : undefined
            }
            problem={problem}
          />
          <ProblemTestcasePanel problemSlug={problem.slug} />
        </section>
      </section>
    </div>
  );
}
