import { notFound } from "next/navigation";

import { setRequestLocale } from "next-intl/server";

import { getCoursePageData } from "@/lib/server/read-model";
import { ManageMembers } from "@/components/course-manage/manage-members";

export const dynamic = "force-dynamic";

export default async function ManageMembersPage({
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
    <ManageMembers
      courseSlug={slug}
      courseTitle={courseData.course.title}
      members={courseData.course.members}
    />
  );
}
