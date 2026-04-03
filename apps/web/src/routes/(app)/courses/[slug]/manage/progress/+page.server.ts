import type { PageServerLoad } from "./$types";
import { courseDomain } from "@nojv/domain";

const { getStudentProgressMatrix } = courseDomain;

export const load: PageServerLoad = async ({ params, parent, url }) => {
  const { courseData } = await parent();
  const assessmentSlug = url.searchParams.get("assessment") ?? undefined;

  const matrix = await getStudentProgressMatrix(params.slug, assessmentSlug);

  const assessments = courseData.course.assessments.map((a) => ({
    slug: a.slug,
    title: a.title
  }));

  return {
    matrix,
    assessments,
    selectedAssessment: assessmentSlug ?? null,
    courseSlug: params.slug
  };
};
