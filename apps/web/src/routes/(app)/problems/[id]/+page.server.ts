import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { contestDomain, courseDomain, problemDomain, submissionDomain } from "@nojv/domain";

const { getAssessmentContext } = courseDomain;
const { getContestAllowedLanguages } = contestDomain;
const { getProblemPageData, getProblemTestcaseSets } = problemDomain;
const { listProblemSubmissions } = submissionDomain;
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { assessmentPath } from "$lib/types";

export const load: PageServerLoad = handleLoad(
  async ({ locals, params, url }: PageServerLoadEvent) => {
    const { id } = params;
    const userId = locals.user?.id ?? null;
    const courseId = url.searchParams.get("course");
    const assessment = url.searchParams.get("assessment");
    const contest = url.searchParams.get("contest");

    // All four inputs come from params/url only — fire them in parallel.
    const [problem, fullTestcaseSets, assessmentContext, contestAllowedLanguages] =
      await Promise.all([
        getProblemPageData(id),
        getProblemTestcaseSets(id),
        courseId && assessment ? getAssessmentContext(courseId, assessment) : null,
        contest ? getContestAllowedLanguages(contest) : null
      ]);

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
          href: assessmentPath(assessmentContext.courseId, assessmentContext.slug),
          type: "assignment" as const
        }
      : undefined;

    const assessmentProp = assessmentContext
      ? {
          assessmentSlug: assessmentContext.slug,
          courseId: assessmentContext.courseId
        }
      : undefined;

    const allowedLanguages =
      contestAllowedLanguages ?? assessmentContext?.allowedLanguages ?? [];

    // ── Submissions (depends on assessmentContext for filtering) ──
    const submissions = userId
      ? await listProblemSubmissions(
          userId,
          id,
          assessmentContext
            ? {
                assessmentSlug: assessmentContext.slug,
                courseId: assessmentContext.courseId
              }
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
  }
);
