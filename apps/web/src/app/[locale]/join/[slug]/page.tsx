import { notFound } from "next/navigation";

import { type LocaleCode } from "@nojv/domain";
import { getCopy, isLocale } from "@nojv/i18n";

import { CourseJoinCallToAction } from "@/components/course-join-call-to-action";
import { getCoursePageData } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function CourseJoinPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ method?: string; token?: string }>;
}) {
  const { locale, slug } = await params;
  const { method, token } = await searchParams;
  const currentLocale: LocaleCode = isLocale(locale) ? locale : "zh-TW";
  const labels = getCopy(currentLocale);
  const courseData = await getCoursePageData(slug);

  if (!courseData) {
    notFound();
  }

  const joinMethod =
    method === "join_code" || method === "qr_code" || method === "manual_invite"
      ? method
      : null;

  return (
    <div className="space-y-6">
      <CourseJoinCallToAction
        courseSlug={slug}
        courseTitle={courseData.course.title}
        joinMethod={joinMethod}
        joinToken={token ?? null}
        locale={currentLocale}
      />
      <section className="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-6 py-6">
        <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
          {labels.navigation.courses}
        </p>
        <p className="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">
          If the current actor does not have the right role, switch actor from the header first
          and retry the join action. The same actor will then be used across problems,
          telemetry, and workspace runs.
        </p>
      </section>
    </div>
  );
}
