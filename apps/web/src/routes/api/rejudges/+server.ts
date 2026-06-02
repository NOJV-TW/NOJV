import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { submissionDomain } from "@nojv/domain";

const batchSchema = z.object({
  problemId: z.string().min(1),
  contestId: z.string().optional(),
  assessmentId: z.string().optional(),
  examId: z.string().optional(),
  userIds: z.array(z.string()).optional(),
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
});

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const body = batchSchema.parse(await event.request.json());

  const batchInput: Parameters<typeof submissionDomain.dispatchRejudge>[0] = {
    mode: "batch",
    problemId: body.problemId,
    triggeredByUserId: actor.userId,
    ...(body.contestId !== undefined ? { contestId: body.contestId } : {}),
    ...(body.assessmentId !== undefined ? { assessmentId: body.assessmentId } : {}),
    ...(body.examId !== undefined ? { examId: body.examId } : {}),
    ...(body.userIds !== undefined ? { userIds: body.userIds } : {}),
    ...(body.since !== undefined ? { since: body.since } : {}),
    ...(body.until !== undefined ? { until: body.until } : {}),
  };

  await submissionDomain.assertBatchRejudgeAccess(actor, batchInput);
  const { workflowId } = await submissionDomain.dispatchRejudge(batchInput);

  return json({ workflowId, status: "queued" }, { status: 202 });
});
