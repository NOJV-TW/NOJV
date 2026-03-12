import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getActiveExamForUser, getAssessmentContext } from "$lib/server/course/queries";
import { getProblemPageData } from "$lib/server/problem/queries";
import { listProblemSubmissions } from "$lib/server/submission/queries";
import { assessmentPath } from "$lib/types";

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const { slug } = params;
  const userId = locals.user?.id ?? null;
  const course = url.searchParams.get("course");
  const assessment = url.searchParams.get("assessment");
  const contest = url.searchParams.get("contest");

  // ── Parallel: exam guard + problem data (independent) ──
  const [activeExam, problem] = await Promise.all([
    userId ? getActiveExamForUser(userId) : null,
    getProblemPageData(slug)
  ]);

  if (activeExam) {
    const isCorrectExamContext =
      course === activeExam.course.slug && assessment === activeExam.slug;

    if (!isCorrectExamContext) {
      redirect(303, assessmentPath(activeExam.course.slug, "exam", activeExam.slug));
    }
  }

  if (!problem) {
    error(404, "Problem not found");
  }

  const assessmentContext =
    course && assessment ? await getAssessmentContext(course, assessment) : null;

  const backLink = assessmentContext
    ? {
        href: assessmentPath(assessmentContext.courseSlug, assessmentContext.type, assessmentContext.slug),
        type: assessmentContext.type
      }
    : undefined;

  const assessmentProp = assessmentContext
    ? {
        assessmentSlug: assessmentContext.slug,
        courseSlug: assessmentContext.courseSlug,
        kind: assessmentContext.type
      }
    : undefined;

  // ── Load submission history (filtered by assessment if present) ──
  const submissions = userId
    ? await listProblemSubmissions(
        userId,
        slug,
        assessmentContext
          ? { assessmentSlug: assessmentContext.slug, courseSlug: assessmentContext.courseSlug }
          : undefined
      )
    : [];

  return {
    assessmentProp,
    backLink,
    contestSlug: contest ?? undefined,
    problem,
    submissions
  };
};
