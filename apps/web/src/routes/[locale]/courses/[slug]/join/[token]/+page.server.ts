import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getCoursePageData } from "$lib/server/read-model";

export const load: PageServerLoad = async ({ params, url }) => {
  const { slug, token } = params;
  const method = url.searchParams.get("method");

  const courseData = await getCoursePageData(slug);

  if (!courseData) {
    error(404, "Course not found");
  }

  const joinMethod =
    method === "join_code" || method === "qr_code" || method === "manual_invite"
      ? method
      : null;

  return {
    courseSlug: slug,
    courseTitle: courseData.course.title,
    joinMethod,
    joinToken: token
  };
};
