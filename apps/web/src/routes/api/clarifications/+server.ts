import { json } from "@sveltejs/kit";

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
import {
  clarificationContextSchema,
  clarificationCreateSchema,
  clarificationListQuerySchema,
} from "@nojv/core";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const context = parseContextQuery(event.url, clarificationContextSchema);
  const sinceRaw = event.url.searchParams.get("since");
  const parsed = clarificationListQuerySchema.parse({
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
  const body = clarificationCreateSchema.parse(await readJsonBody(event));
  const row = await clarificationDomain.ask(actor, {
    context: body.context,
    problemId: body.problemId ?? null,
    questionText: body.questionText,
  });
  return json(row, { status: 201 });
});
