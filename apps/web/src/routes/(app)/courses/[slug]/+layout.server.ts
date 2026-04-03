import { error } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import { courseDomain } from "@nojv/domain";

const { getCoursePageData } = courseDomain;

export const load: LayoutServerLoad = async ({ params }) => {
  const courseData = await getCoursePageData(params.slug);

  if (!courseData) {
    error(404, "Course not found");
  }

  return { courseData };
};
