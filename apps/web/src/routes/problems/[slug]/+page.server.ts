import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getCoursePageData, getProblemPageData } from "$lib/server/queries";

export const load: PageServerLoad = async ({ params, url }) => {
  const { slug } = params;
  const course = url.searchParams.get("course");
  const assessment = url.searchParams.get("assessment");

  const [problem, courseData] = await Promise.all([
    getProblemPageData(slug),
    course ? getCoursePageData(course) : null
  ]);

  if (!problem) {
    error(404, "Problem not found");
  }

  const courseContext = courseData?.course;
  const assessmentContext = assessment
    ? courseContext?.assessments.find((entry) => entry.slug === assessment)
    : undefined;
  const boundCourseSlug = courseContext?.slug ?? course ?? "course";

  const backLink = assessmentContext
    ? {
        href:
          assessmentContext.type === "exam"
            ? `/courses/${boundCourseSlug}/exams/${assessmentContext.slug}`
            : `/courses/${boundCourseSlug}/assignments/${assessmentContext.slug}`,
        label: assessmentContext.type === "exam" ? "Back to Exam" : "Back to Assignment"
      }
    : undefined;

  const assessmentProp = assessmentContext
    ? {
        assessmentSlug: assessmentContext.slug,
        courseSlug: courseContext?.slug ?? "",
        kind: assessmentContext.type
      }
    : undefined;

  return {
    assessmentProp,
    backLink,
    problem
  };
};
