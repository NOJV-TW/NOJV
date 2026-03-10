import Link from "next/link";

import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";

import type { PlatformRole } from "@nojv/domain";
import { shellClassNames } from "@nojv/ui";

import { auth } from "@/lib/auth";
import { canCreateCourse } from "@/lib/server/authorization";
import { listCourseCards, listUserCourseCards } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function CoursesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [tNav, tCourse, tCommon] = await Promise.all([
    getTranslations("navigation"),
    getTranslations("courseDetail"),
    getTranslations("common")
  ]);

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user.id ?? null;
  const platformRole =
    ((session?.user as Record<string, unknown> | undefined)?.platformRole as
      | PlatformRole
      | undefined) ?? "student";
  const isStaff = canCreateCourse(platformRole);

  const courses = isStaff
    ? await listCourseCards()
    : userId
      ? await listUserCourseCards(userId)
      : [];

  return (
    <div className="space-y-6">
      <h2 className="font-[family-name:var(--font-display)] text-3xl">{tNav("courses")}</h2>

      {courses.length === 0 && (
        <p className="text-sm text-[color:var(--color-muted)]">{tCourse("empty")}</p>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        {courses.map((course) => (
          <Link
            className={`${shellClassNames.card} px-6 py-6`}
            href={`/${locale}/courses/${course.slug}`}
            key={course.slug}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
                  {tCourse("course")}
                </p>
                <h3 className="mt-2 text-2xl font-semibold">{course.title}</h3>
              </div>
              <span className={shellClassNames.badge}>{tCourse("rbacEnabled")}</span>
            </div>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-[color:var(--color-muted)]">
                  {tCommon("members")}
                </dt>
                <dd className="mt-1 text-lg font-semibold">{course.memberCount}</dd>
              </div>
              <div>
                <dt className="text-sm text-[color:var(--color-muted)]">
                  {tCommon("assessments")}
                </dt>
                <dd className="mt-1 text-lg font-semibold">{course.assessmentCount}</dd>
              </div>
            </dl>
          </Link>
        ))}
      </section>
    </div>
  );
}
