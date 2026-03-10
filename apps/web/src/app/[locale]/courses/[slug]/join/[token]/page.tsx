import { notFound } from "next/navigation";

import { getTranslations, setRequestLocale } from "next-intl/server";

import { CourseJoinCallToAction } from "@/components/course-join-call-to-action";
import { getCoursePageData } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function CourseJoinPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string; slug: string; token: string }>;
  searchParams: Promise<{ method?: string }>;
}) {
  const { locale, slug, token } = await params;
  const { method } = await searchParams;
  setRequestLocale(locale);

  const [tNav, tJoin] = await Promise.all([
    getTranslations("navigation"),
    getTranslations("courseJoin")
  ]);
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
        joinToken={token}
      />
      <section className="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-6 py-6">
        <p className="text-sm uppercase tracking-[0.18em] text-[color:var(--color-muted)]">
          {tNav("courses")}
        </p>
        <p className="mt-3 text-sm leading-7 text-[color:var(--color-muted)]">
          {tJoin("hint")}
        </p>
      </section>
    </div>
  );
}
