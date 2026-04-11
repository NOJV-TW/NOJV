import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { contestDomain, courseDomain, problemDomain, submissionDomain } from "@nojv/domain";

const { getAssessmentContext } = courseDomain;
const { getContestAllowedLanguages } = contestDomain;
const { getProblemPageData, getProblemTestcaseSets } = problemDomain;
const { listProblemSubmissions } = submissionDomain;
import { assessmentPath } from "$lib/types";

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const { id } = params;
  const userId = locals.user?.id ?? null;
  const course = url.searchParams.get("course");
  const assessment = url.searchParams.get("assessment");
  const contest = url.searchParams.get("contest");

  // All four inputs come from params/url only — fire them in parallel.
  const [problem, fullTestcaseSets, assessmentContext, contestAllowedLanguages] =
    await Promise.all([
      getProblemPageData(id),
      getProblemTestcaseSets(id),
      course && assessment ? getAssessmentContext(course, assessment) : null,
      contest ? getContestAllowedLanguages(contest) : null
    ]);

  if (!problem) {
    error(404, "Problem not found");
  }

  // Testcase set summaries strip the actual input/output payloads —
  // students must never see hidden testcase contents.
  const testcaseSetSummaries = fullTestcaseSets.map((set) => ({
    id: set.id,
    name: set.name,
    description: set.description,
    weight: set.weight,
    ordinal: set.ordinal,
    caseCount: set.testcases.length
  }));

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
    submissions,
    testcaseSets: testcaseSetSummaries
  };
};
