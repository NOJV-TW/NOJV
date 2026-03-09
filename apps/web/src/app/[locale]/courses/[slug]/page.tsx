import { notFound } from "next/navigation";

import { getTranslations, setRequestLocale } from "next-intl/server";
import { shellClassNames } from "@nojv/ui";

import { CourseAssessmentBoard } from "@/components/course-assessment-board";
import { CourseJoinPanel } from "@/components/course-join-panel";
import { CourseManagementConsole } from "@/components/course-management-console";
import { CourseMembershipPanel } from "@/components/course-membership-panel";
import { CourseProblemShelf } from "@/components/course-problem-shelf";
import { getCoursePageData } from "@/lib/server/read-model";

export const dynamic = "force-dynamic";

export default async function CourseDetailPage({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const [tNav, tCourse, tCommon] = await Promise.all([
    getTranslations("navigation"),
    getTranslations("courseDetail"),
    getTranslations("common")
  ]);
  const courseData = await getCoursePageData(slug);
  const course = courseData?.course;

  if (!course) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <section className={`${shellClassNames.cardStrong} px-6 py-8 sm:px-8`}>
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className={shellClassNames.eyebrow}>
              {tNav("courses")} / {course.slug}
            </p>
            <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl">
              {course.title}
            </h2>
            <p className="mt-4 max-w-3xl text-base leading-7 text-[color:var(--color-muted)]">
              {course.description}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <div className={`${shellClassNames.card} px-4 py-4`}>
              <p className="text-sm text-[color:var(--color-muted)]">{tCommon("members")}</p>
              <p className="mt-2 text-lg font-semibold">{course.members.length}</p>
            </div>
            <div className={`${shellClassNames.card} px-4 py-4`}>
              <p className="text-sm text-[color:var(--color-muted)]">{tCommon("assessments")}</p>
              <p className="mt-2 text-lg font-semibold">{course.assessments.length}</p>
            </div>
            <div className={`${shellClassNames.card} px-4 py-4`}>
              <p className="text-sm text-[color:var(--color-muted)]">{tCourse("problemPool")}</p>
              <p className="mt-2 text-lg font-semibold">{course.problemSlugs.length}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <CourseManagementConsole course={course} />
          <CourseAssessmentBoard
            assessments={course.assessments}
            courseSlug={course.slug}
          />
          <CourseProblemShelf
            courseSlug={course.slug}
            problems={courseData.problems}
          />
        </div>
        <div className="space-y-6">
          <CourseMembershipPanel members={course.members} />
          <CourseJoinPanel
            courseSlug={course.slug}
            joinChannels={course.joinChannels}
          />
        </div>
      </section>
    </div>
  );
}
