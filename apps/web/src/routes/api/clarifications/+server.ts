import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import {
  apiHandler,
  writeApiHandler,
  assertJsonBodyWithinLimit,
  parseContextQuery,
  readJsonBody,
} from "$lib/server/shared/api-handler";
import { clarificationDomain } from "@nojv/application";

const contextSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assignment"), assignmentId: z.string().min(1) }),
  z.object({ type: z.literal("exam"), examId: z.string().min(1) }),
  z.object({ type: z.literal("contest"), contestId: z.string().min(1) }),
]);

const listQuerySchema = z.object({
  context: contextSchema,
  since: z.iso.datetime().optional(),
});

const askSchema = z.object({
  context: contextSchema,
  problemId: z.string().min(1).optional().nullable(),
  questionText: z.string().min(10).max(1000),
});

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const context = parseContextQuery(event.url, contextSchema);
  const sinceRaw = event.url.searchParams.get("since");
  const parsed = listQuerySchema.parse({
    context,
    since: sinceRaw ?? undefined,
  });

  const since = parsed.since ? new Date(parsed.since) : undefined;
  const items = await clarificationDomain.listForViewer(actor, parsed.context, since);
  return json({ items });
});

export const POST: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const body = askSchema.parse(await readJsonBody(event));
  const row = await clarificationDomain.ask(actor, {
    context: body.context,
    problemId: body.problemId ?? null,
    questionText: body.questionText,
  });
  return json(row, { status: 201 });
});
