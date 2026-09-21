import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import {
  apiHandler,
  writeApiHandler,
  assertJsonBodyWithinLimit,
  readJsonBody,
} from "$lib/server/shared/api-handler";
import { submissionDomain } from "@nojv/application";

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
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const body = batchSchema.parse(await readJsonBody(event));

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

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const problemId = z.string().min(1).max(128).parse(event.url.searchParams.get("problemId"));
  let rawScope: unknown;
  try {
    rawScope = JSON.parse(event.url.searchParams.get("scope") ?? "{}");
  } catch {
    return json({ message: "Invalid rejudge scope." }, { status: 400 });
  }
  const scope = batchSchema
    .pick({ contestId: true, assessmentId: true, examId: true })
    .strict()
    .parse(rawScope);
  return json(
    await submissionDomain.listActiveRejudges(actor, {
      problemId,
      scope: {
        ...(scope.contestId ? { contestId: scope.contestId } : {}),
        ...(scope.assessmentId ? { assessmentId: scope.assessmentId } : {}),
        ...(scope.examId ? { examId: scope.examId } : {}),
      },
    }),
  );
});
