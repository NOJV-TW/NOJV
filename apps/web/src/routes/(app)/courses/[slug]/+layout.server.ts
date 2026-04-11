import type { LayoutServerLoad, LayoutServerLoadEvent } from "./$types";
import { courseDomain } from "@nojv/domain";

const { getCoursePageData } = courseDomain;
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: LayoutServerLoad = handleLoad(async ({ params }: LayoutServerLoadEvent) => {
  const courseData = await getCoursePageData(params.slug);

  return { courseData };
});
