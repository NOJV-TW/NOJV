import Link from "next/link";

import { getCopy, isLocale } from "@nojv/i18n";
import { shellClassNames } from "@nojv/ui";

import { CourseCreationPanel } from "@/components/course-creation-panel";
import { listCourseCards } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function CoursesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const currentLocale = isLocale(locale) ? locale : "zh-TW";
  const labels = getCopy(currentLocale);
  const courses = await listCourseCards();

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-8 sm:px-8`}>
        <p className={shellClassNames.eyebrow}>{labels.navigation.courses}</p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
          Course management adds teacher workflows on top of the judge backbone.
        </h2>
        <p className="mt-4 max-w-3xl text-base leading-7 text-[color:var(--color-muted)]">
          Teachers can create courses, publish assignments or exams, pull in public or private
          problems, and manage enrollment via QR code, join code, or manual account creation.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <CourseCreationPanel locale={currentLocale} />
        {courses.map((course) => (
          <Link
            className={`${shellClassNames.card} px-6 py-6`}
            href={`/${currentLocale}/courses/${course.slug}`}
            key={course.slug}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                  course
                </p>
                <h3 className="mt-2 text-2xl font-semibold">{course.title}</h3>
              </div>
              <span className={shellClassNames.badge}>rbac enabled</span>
            </div>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-[color:var(--color-muted)]">Members</dt>
                <dd className="mt-1 text-lg font-semibold">{course.memberCount}</dd>
              </div>
              <div>
                <dt className="text-sm text-[color:var(--color-muted)]">Assessments</dt>
                <dd className="mt-1 text-lg font-semibold">{course.assessmentCount}</dd>
              </div>
            </dl>
          </Link>
        ))}
      </section>
    </div>
  );
}
