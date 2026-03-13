import type { PageServerLoad } from "./$types";
import { getStudentProgressMatrix } from "$lib/server/course/progress";

export const load: PageServerLoad = async ({ params, parent, url }) => {
  const { courseData } = await parent();
  const assessmentSlug = url.searchParams.get("assessment") ?? undefined;

  const matrix = await getStudentProgressMatrix(params.slug, assessmentSlug);

  const assessments = courseData.course.assessments
    .filter((a) => a.type === "assignment" || a.type === "exam")
    .map((a) => ({ slug: a.slug, title: a.title, type: a.type }));

  return {
    matrix,
    assessments,
    selectedAssessment: assessmentSlug ?? null,
    courseSlug: params.slug
  };
};
