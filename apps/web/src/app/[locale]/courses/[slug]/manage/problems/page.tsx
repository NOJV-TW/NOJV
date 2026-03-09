import { notFound } from "next/navigation";

import { setRequestLocale } from "next-intl/server";

import { getCoursePageData } from "@/lib/server/read-model";
import { ManageProblems } from "@/components/course-manage/manage-problems";

export const dynamic = "force-dynamic";

export default async function ManageProblemsPage({
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

  return (
    <ManageProblems
      courseSlug={slug}
      courseTitle={courseData.course.title}
      problems={courseData.problems}
    />
  );
}
