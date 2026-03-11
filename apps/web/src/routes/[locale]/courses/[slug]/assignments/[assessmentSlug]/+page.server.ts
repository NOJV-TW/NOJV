import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getCoursePageData } from "$lib/server/read-model";
import {
  deriveAssessmentPresentation,
  deriveAssessmentWindowState
} from "$lib/course-assessment-helpers";

export const load: PageServerLoad = async ({ params }) => {
  const { assessmentSlug, locale, slug } = params;

  const courseData = await getCoursePageData(slug);
  const course = courseData?.course;
  const assessment = course?.assessments.find((entry) => entry.slug === assessmentSlug);

  if (!course || assessment?.type !== "assignment") {
    error(404, "Assignment not found");
  }

  const problemsBySlug = new Map(
    (courseData?.problems ?? []).map((problem) => [problem.slug, problem])
  );

  const presentation = deriveAssessmentPresentation({
    scoreboardMode: assessment.scoreboardMode,
    type: assessment.type
  });
  const windowState = deriveAssessmentWindowState({
    closesAt: assessment.closesAt,
    dueAt: assessment.dueAt,
    opensAt: assessment.opensAt
  });

  const problems = assessment.problemSlugs
    .map((ps) => problemsBySlug.get(ps))
    .filter((p): p is NonNullable<typeof p> => p != null);

  return {
    assessment,
    course,
    presentation,
    problems,
    type: "assignment" as const,
    windowState
  };
};
