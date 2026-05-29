import { error } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";

import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { feedbackDomain, submissionDomain } from "@nojv/domain";

const { getSubmissionDetail } = submissionDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const { submissionId } = event.params;
  if (!submissionId) error(400, "Missing submissionId.");

  const submission = await getSubmissionDetail(actor, submissionId);

  const ctx = submission.context;
  const feedbackContext: feedbackDomain.FeedbackContext | null =
    ctx.kind === "assignment"
      ? { type: "assignment", assignmentId: ctx.assignmentId }
      : ctx.kind === "exam"
        ? { type: "exam", examId: ctx.examId }
        : null;
  let feedback: string | null = null;
  if (feedbackContext) {
    const rows = await feedbackDomain.getFeedbackForStudent(actor.userId, feedbackContext);
    feedback = rows.find((r) => r.problemId === submission.problem.id)?.comment ?? null;
  }

  return { submission, feedback };
});
