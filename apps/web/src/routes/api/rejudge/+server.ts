import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { NotFoundError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { submissionRepo } from "@nojv/db";
import { submissionDomain } from "@nojv/domain";

const singleSchema = z.object({
  mode: z.literal("single"),
  submissionId: z.string().min(1)
});

const batchSchema = z.object({
  mode: z.literal("batch"),
  problemId: z.string().min(1),
  contestId: z.string().optional(),
  assessmentId: z.string().optional(),
  examId: z.string().optional(),
  userIds: z.array(z.string()).optional(),
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional()
});

const bodySchema = z.discriminatedUnion("mode", [singleSchema, batchSchema]);

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const body = bodySchema.parse(await event.request.json());

  if (body.mode === "single") {
    const submission = await submissionRepo.findById(body.submissionId);
    if (!submission) throw new NotFoundError("Submission not found.");

    await submissionDomain.assertCanOperateOnSubmission(actor, submission);
    await submissionDomain.dispatchRejudge({
      mode: "single",
      submissionId: submission.id,
      triggeredByUserId: actor.userId
    });

    return json({ queued: 1 });
  }

  // Drop undefined optional keys to satisfy exactOptionalPropertyTypes
  // in the authz + dispatch input contracts.
  const batchInput: Parameters<typeof submissionDomain.dispatchRejudge>[0] = {
    mode: "batch",
    problemId: body.problemId,
    triggeredByUserId: actor.userId,
    ...(body.contestId !== undefined ? { contestId: body.contestId } : {}),
    ...(body.assessmentId !== undefined ? { assessmentId: body.assessmentId } : {}),
    ...(body.examId !== undefined ? { examId: body.examId } : {}),
    ...(body.userIds !== undefined ? { userIds: body.userIds } : {}),
    ...(body.since !== undefined ? { since: body.since } : {}),
    ...(body.until !== undefined ? { until: body.until } : {})
  };

  await submissionDomain.assertBatchRejudgeAccess(actor, batchInput);
  await submissionDomain.dispatchRejudge(batchInput);

  return json({ queued: "batch-dispatched" });
});
