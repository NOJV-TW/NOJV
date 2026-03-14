import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getAssessmentContext } from "$lib/server/course/queries";
import {
  getActiveContestForUser,
  getContestAllowedLanguages
} from "$lib/server/contest/queries";
import { getProblemPageData } from "$lib/server/problem/queries";
import { listProblemSubmissions } from "$lib/server/submission/queries";
import { assessmentPath } from "$lib/types";

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const { slug } = params;
  const userId = locals.user?.id ?? null;
  const course = url.searchParams.get("course");
  const assessment = url.searchParams.get("assessment");
  const contest = url.searchParams.get("contest");

  // ── Parallel: active contest guard + problem data (independent) ──
  const [activeContest, problem] = await Promise.all([
    userId ? getActiveContestForUser(userId) : null,
    getProblemPageData(slug)
  ]);

  if (activeContest) {
    const isCorrectContestContext = contest === activeContest.slug;

    if (!isCorrectContestContext) {
      redirect(303, `/contests/${activeContest.slug}`);
    }
  }

  if (!problem) {
    error(404, "Problem not found");
  }

  // ── Parallel: assessment context + contest languages (independent) ──
  const [assessmentContext, contestAllowedLanguages] = await Promise.all([
    course && assessment ? getAssessmentContext(course, assessment) : null,
    contest ? getContestAllowedLanguages(contest) : null
  ]);

  const backLink = assessmentContext
    ? {
        href: assessmentPath(assessmentContext.courseSlug, assessmentContext.slug),
        type: "assignment" as const
      }
    : undefined;

  const assessmentProp = assessmentContext
    ? {
        assessmentSlug: assessmentContext.slug,
        courseSlug: assessmentContext.courseSlug
      }
    : undefined;

  const allowedLanguages = contestAllowedLanguages ?? assessmentContext?.allowedLanguages ?? [];

  // ── Submissions (depends on assessmentContext for filtering) ──
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
    allowedLanguages,
    assessmentProp,
    backLink,
    contestSlug: contest ?? undefined,
    problem,
    submissions
  };
};
