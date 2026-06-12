import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import {
  apiHandler,
  writeApiHandler,
  assertJsonBodyWithinLimit,
} from "$lib/server/shared/api-handler";
import { scoreOverrideDomain } from "@nojv/domain";

const contextSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assignment"), assignmentId: z.string().min(1) }),
  z.object({ type: z.literal("exam"), examId: z.string().min(1) }),
  z.object({ type: z.literal("contest"), contestId: z.string().min(1) }),
]);

const createSchema = z.object({
  userId: z.string().min(1),
  problemId: z.string().min(1),
  context: contextSchema,
  overrideScore: z.number().int().min(0),
  reason: z.string().min(1).max(500),
});

function parseContextQuery(url: URL): z.infer<typeof contextSchema> {
  const type = url.searchParams.get("type");
  if (type === "assignment") {
    return contextSchema.parse({ type, assignmentId: url.searchParams.get("assignmentId") });
  }
  if (type === "exam") {
    return contextSchema.parse({ type, examId: url.searchParams.get("examId") });
  }
  if (type === "contest") {
    return contextSchema.parse({ type, contestId: url.searchParams.get("contestId") });
  }
  return contextSchema.parse({ type });
}

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const context = parseContextQuery(event.url);

  await scoreOverrideDomain.assertCanViewScoreOverrides(actor, context);

  const items = await scoreOverrideDomain.listByContext(context);
  return json({ items });
});

export const POST: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const body = createSchema.parse(await event.request.json());

  const row = await scoreOverrideDomain.createOverride(actor, body);
  return json(row, { status: 201 });
});
