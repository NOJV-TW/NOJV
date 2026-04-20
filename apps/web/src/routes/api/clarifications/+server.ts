import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";
import { clarificationDomain } from "@nojv/domain";

const contextTypeSchema = z.enum(["contest", "exam", "assignment"]);

const listQuerySchema = z.object({
  contextType: contextTypeSchema,
  contextId: z.string().min(1),
  since: z.iso.datetime().optional(),
});

const askSchema = z.object({
  contextType: contextTypeSchema,
  contextId: z.string().min(1),
  problemId: z.string().min(1).optional().nullable(),
  questionText: z.string().min(10).max(1000),
});

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const parsed = listQuerySchema.parse({
    contextType: event.url.searchParams.get("contextType"),
    contextId: event.url.searchParams.get("contextId"),
    since: event.url.searchParams.get("since") ?? undefined,
  });

  const since = parsed.since ? new Date(parsed.since) : undefined;
  const items = await clarificationDomain.listForViewer(
    actor,
    parsed.contextType,
    parsed.contextId,
    since,
  );
  return json({ items });
});

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const body = askSchema.parse(await event.request.json());
  const row = await clarificationDomain.ask(actor, {
    contextType: body.contextType,
    contextId: body.contextId,
    problemId: body.problemId ?? null,
    questionText: body.questionText,
  });
  return json(row, { status: 201 });
});
