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
import { feedbackUpsertSchema } from "@nojv/core";
import { feedbackDomain } from "@nojv/application";

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
  return contextSchema.parse({ type });
}

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const context = parseContextQuery(event.url);

  await feedbackDomain.assertCanViewFeedback(actor, context);

  const items = await feedbackDomain.listFeedbackForContext(context);
  return json({ items });
});

export const PUT: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const { context, ...input } = upsertSchema.parse(await readJsonBody(event));

  const row = await feedbackDomain.upsertFeedback(actor, { context, input });
  return json(row);
});
