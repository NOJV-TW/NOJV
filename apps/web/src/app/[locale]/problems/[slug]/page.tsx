import Link from "next/link";
import { notFound } from "next/navigation";

import { type LocaleCode } from "@nojv/domain";
import { getCopy, isLocale } from "@nojv/i18n";
import { shellClassNames } from "@nojv/ui";

import { ProblemEditor } from "@/components/problem-editor";
import { ProblemTestcasePanel } from "@/components/problem-testcase-panel";
import { getContestPageData, getCoursePageData, getProblemPageData } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function ProblemDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ assessment?: string; contest?: string; course?: string }>;
}) {
  const { locale, slug } = await params;
  const { assessment, contest, course } = await searchParams;
  const currentLocale: LocaleCode = isLocale(locale) ? locale : "zh-TW";
  const labels = getCopy(currentLocale);
  const problem = await getProblemPageData(slug, currentLocale);
  const contestContext = contest ? await getContestPageData(contest) : undefined;
  const courseData = course ? await getCoursePageData(course) : null;
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
              {labels.navigation.problems} / {problem.slug}
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
              <p className="text-sm text-[color:var(--color-muted)]">Difficulty</p>
              <p className="mt-2 text-lg font-semibold capitalize">{problem.difficulty}</p>
            </div>
            <div className={`${shellClassNames.card} px-4 py-4`}>
              <p className="text-sm text-[color:var(--color-muted)]">Acceptance</p>
              <p className="mt-2 text-lg font-semibold">
                {Math.round(problem.acceptanceRate * 100)}%
              </p>
            </div>
            <div className={`${shellClassNames.card} px-4 py-4`}>
              <p className="text-sm text-[color:var(--color-muted)]">Context</p>
              <p className="mt-2 text-lg font-semibold">
                {contestContext
                  ? contestContext.title
                  : assessmentContext
                    ? `${courseContext?.title ?? "Course"} / ${assessmentContext.title}`
                    : courseContext
                      ? courseContext.title
                      : "Practice catalog"}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className={`${shellClassNames.card} px-6 py-6`}>
          <p className={shellClassNames.eyebrow}>Problem brief</p>
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
                <p className="text-sm font-semibold">Sample {index + 1}</p>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-2xl bg-stone-900/95 px-3 py-3 text-xs leading-6 text-stone-100">
                  Input
                  {"\n"}
                  {sample.input}
                  {"\n\n"}
                  Output
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
          {contestContext ? (
            <div className={`${shellClassNames.card} px-5 py-5`}>
              <p className={shellClassNames.eyebrow}>Contest binding</p>
              <p className="mt-2 text-lg font-semibold">{contestContext.title}</p>
              <p className="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">
                This editor is linked to the contest zone, so submission mode and telemetry
                thresholds are stricter than practice mode.
              </p>
              <Link
                className="mt-4 inline-flex rounded-full border border-[color:var(--color-border)] px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-white/70"
                href={`/${currentLocale}/contests/${contestContext.slug}`}
              >
                Back to contest zone
              </Link>
            </div>
          ) : assessmentContext ? (
            <div className={`${shellClassNames.card} px-5 py-5`}>
              <p className={shellClassNames.eyebrow}>Course binding</p>
              <p className="mt-2 text-lg font-semibold">{assessmentContext.title}</p>
              <p className="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">
                This editor is linked to the {assessmentContext.type} surface inside{" "}
                {courseContext?.title ?? "the course"}, so submissions and telemetry now carry
                course assessment context.
              </p>
              <Link
                className="mt-4 inline-flex rounded-full border border-[color:var(--color-border)] px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-white/70"
                href={
                  assessmentContext.type === "exam"
                    ? `/${currentLocale}/courses/${boundCourseSlug}/exams/${assessmentContext.slug}`
                    : `/${currentLocale}/courses/${boundCourseSlug}/assignments/${assessmentContext.slug}`
                }
              >
                Back to {assessmentContext.type}
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
            contestSlug={contestContext?.slug}
            locale={currentLocale}
            problem={problem}
          />
          <ProblemTestcasePanel problemSlug={problem.slug} />
        </section>
      </section>
    </div>
  );
}
