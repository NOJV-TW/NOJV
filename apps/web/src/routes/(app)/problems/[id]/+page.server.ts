import { error } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { contestDomain, courseDomain, problemDomain, submissionDomain } from "@nojv/domain";
import { assessmentProblemRepo, contestProblemRepo, problemRepo } from "@nojv/db";

const { getAssessmentContext } = courseDomain;
const { getContestContext } = contestDomain;
const { assertProblemViewAccess, getProblemPageData, getProblemTestcaseSets } = problemDomain;
const { listProblemSubmissions } = submissionDomain;
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { assessmentPath } from "$lib/types";

export const load: PageServerLoad = handleLoad(
  async ({ locals, params, url }: PageServerLoadEvent) => {
    const { id } = params;
    const actor = locals.sessionUser;
    if (!actor) {
      // The layout is supposed to gate auth, but handle this defensively
      // since getProblemPageData has no requireAuth of its own.
      error(401, "Login required");
    }
    const userId = actor.id;
    const courseId = url.searchParams.get("course");
    const assessment = url.searchParams.get("assessment");
    const contest = url.searchParams.get("contest");

    // ── Resolve the problem row and contexts in parallel. getAssessmentContext
    // now enforces enrollment + time-window; any forged ?course=X&assessment=Y
    // resolves to null so the problem stays locked below. ──
    const [problemRow, assessmentContext, contestContext] = await Promise.all([
      problemRepo.findById(id),
      courseId && assessment
        ? getAssessmentContext(courseId, assessment, {
            viewerUserId: userId,
            viewerPlatformRole: actor.platformRole
          })
        : null,
      contest
        ? getContestContext(contest, {
            viewerUserId: userId,
            viewerPlatformRole: actor.platformRole
          })
        : null
    ]);

    if (!problemRow) {
      error(404, "Problem not found");
    }

    // ── Visibility gate. A private problem opens only when the context
    // actually contains the problem AND the context itself already passed
    // enrollment + time-window validation (done inside getAssessmentContext
    // / getContestContext above). ──
    const problemInAssessment =
      assessmentContext != null &&
      (await assessmentProblemRepo.exists(assessmentContext.assessmentId, id));
    const problemInContest =
      contestContext != null &&
      (await contestProblemRepo.existsBySlug(contestContext.slug, id));
    const contextIncludesProblem = problemInAssessment || problemInContest;

    await assertProblemViewAccess(
      { id: problemRow.id, authorId: problemRow.authorId, visibility: problemRow.visibility },
      {
        userId,
        username: actor.username ?? "",
        platformRole: actor.platformRole
      },
      { contextIncludesProblem }
    );

    // Now that we've confirmed view access, load the display payload +
    // testcase summaries (never leak hidden I/O — stripped at line below).
    const [problem, fullTestcaseSets] = await Promise.all([
      getProblemPageData(id),
      getProblemTestcaseSets(id)
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
      contestContext?.allowedLanguages ?? assessmentContext?.allowedLanguages ?? [];

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
      contestSlug: contestContext?.slug,
      problem,
      submissions,
      testcaseSets: testcaseSetSummaries
    };
  }
);
