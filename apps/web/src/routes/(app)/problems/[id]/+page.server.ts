import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { contestDomain, courseDomain, problemDomain, submissionDomain } from "@nojv/domain";

const { getAssessmentContext } = courseDomain;
const { getContestAllowedLanguages } = contestDomain;
const { getProblemPageData } = problemDomain;
const { listProblemSubmissions } = submissionDomain;
import { assessmentPath } from "$lib/types";

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const { id } = params;
  const userId = locals.user?.id ?? null;
  const course = url.searchParams.get("course");
  const assessment = url.searchParams.get("assessment");
  const contest = url.searchParams.get("contest");

  const problem = await getProblemPageData(id);

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
        id,
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
