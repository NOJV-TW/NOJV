import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";
import { clarificationDomain } from "@nojv/domain";

/**
 * Wire shape: discriminated union keyed by `type`. Replaces the legacy
 * `{ contextType, contextId }` flat pair; the domain function now takes
 * a `ClarificationContext` union directly.
 */
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

function parseContextQuery(url: URL): z.infer<typeof contextSchema> {
  // Query string carries the discriminated union as a flat
  // `type=...&assignmentId=...` (or `examId` / `contestId`). We hand the
  // correctly-shaped object to Zod's discriminated-union parser.
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
  const actor = requireApiAuth(event);
  const body = askSchema.parse(await event.request.json());
  const row = await clarificationDomain.ask(actor, {
    context: body.context,
    problemId: body.problemId ?? null,
    questionText: body.questionText,
  });
  return json(row, { status: 201 });
});
