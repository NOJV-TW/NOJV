import { error } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import { getCoursePageData } from "$lib/server/queries";

export const load: LayoutServerLoad = async ({ params }) => {
  const courseData = await getCoursePageData(params.slug);

  if (!courseData) {
    error(404, "Course not found");
  }

  return { courseData };
};
