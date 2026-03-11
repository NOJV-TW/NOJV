import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getCoursePageData } from "$lib/server/read-model";

export const load: PageServerLoad = async ({ params }) => {
  const courseData = await getCoursePageData(params.slug);

  if (!courseData) {
    error(404, "Course not found");
  }

  return {
    courseSlug: params.slug,
    courseTitle: courseData.course.title,
    members: courseData.course.members
  };
};
