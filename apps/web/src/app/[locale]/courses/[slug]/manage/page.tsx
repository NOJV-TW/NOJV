import { notFound } from "next/navigation";

import { setRequestLocale } from "next-intl/server";
import { shellClassNames } from "@nojv/ui";

import { getCoursePageData } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function ManageOverviewPage({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const courseData = await getCoursePageData(slug);

  if (!courseData) {
    notFound();
  }

  const { course, problems } = courseData;

  return (
    <section className={`${shellClassNames.cardStrong} px-6 py-8`}>
      <p className={shellClassNames.eyebrow}>Manage / {course.slug}</p>
      <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl">{course.title}</h2>
      <p className="mt-4 text-[color:var(--color-muted)]">{course.description}</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className={`${shellClassNames.card} px-4 py-4`}>
          <p className="text-sm text-[color:var(--color-muted)]">Members</p>
          <p className="mt-2 text-2xl font-semibold">{course.members.length}</p>
        </div>
        <div className={`${shellClassNames.card} px-4 py-4`}>
          <p className="text-sm text-[color:var(--color-muted)]">Assessments</p>
          <p className="mt-2 text-2xl font-semibold">{course.assessments.length}</p>
        </div>
        <div className={`${shellClassNames.card} px-4 py-4`}>
          <p className="text-sm text-[color:var(--color-muted)]">Problems</p>
          <p className="mt-2 text-2xl font-semibold">{problems.length}</p>
        </div>
      </div>
    </section>
  );
}
