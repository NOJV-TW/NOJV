import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";
import { feedbackUpsertSchema } from "@nojv/core";
import { feedbackDomain } from "@nojv/domain";

/**
 * Wire shape: discriminated union keyed by `type`. Mirrors `/api/overrides`
 * but with only two members — grading feedback can only be written against
 * an assignment or an exam (no contest). Maps to a `FeedbackContext`.
 */
const contextSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assignment"), assignmentId: z.string().min(1) }),
  z.object({ type: z.literal("exam"), examId: z.string().min(1) }),
]);

const upsertSchema = z.object({
  context: contextSchema,
  ...feedbackUpsertSchema.shape,
});

function parseContextQuery(url: URL): z.infer<typeof contextSchema> {
  const type = url.searchParams.get("type");
  if (type === "assignment") {
    return contextSchema.parse({ type, assignmentId: url.searchParams.get("assignmentId") });
  }
  if (type === "exam") {
    return contextSchema.parse({ type, examId: url.searchParams.get("examId") });
  }
  // Anything else (including `contest`) fails the discriminated union → 400.
  return contextSchema.parse({ type });
}

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const context = parseContextQuery(event.url);

  // Listing surfaces staff-authored comments, so gate on the same
  // permission required to write feedback — students must never reach this.
  await feedbackDomain.assertCanWriteFeedback(actor, context);

  const items = await feedbackDomain.listFeedbackForContext(context);
  return json({ items });
});

export const PUT: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const { context, ...input } = upsertSchema.parse(await event.request.json());

  const row = await feedbackDomain.upsertFeedback(actor, { context, input });
  return json(row);
});
