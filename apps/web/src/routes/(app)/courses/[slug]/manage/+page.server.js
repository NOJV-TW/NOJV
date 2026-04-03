/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */

import { courseDomain } from "@nojv/domain";

const { getCourseManageAnalytics } = courseDomain;

export const load = async ({ parent }) => {
  const { courseData } = await parent();
  const courseSlug = courseData.course.slug;

  const analytics = await getCourseManageAnalytics(courseSlug, courseData.course.members);

  return { analytics };
};
