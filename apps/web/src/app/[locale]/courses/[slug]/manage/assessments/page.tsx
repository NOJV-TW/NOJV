import { notFound } from "next/navigation";

import { setRequestLocale } from "next-intl/server";

import { getCoursePageData } from "@/lib/server/read-model";
import { ManageAssessments } from "@/components/course-manage/manage-assessments";

export const dynamic = "force-dynamic";

export default async function ManageAssessmentsPage({
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
    <ManageAssessments
      assessments={courseData.course.assessments}
      courseSlug={slug}
      problemSlugs={courseData.course.problemSlugs}
    />
  );
}
