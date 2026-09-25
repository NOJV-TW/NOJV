import { json } from "@sveltejs/kit";
import {
  codeDraftSaveSchema,
  codeDraftScopeSchema,
  MAX_SUBMISSION_BODY_BYTES,
} from "@nojv/core";
import { codeDraftDomain, HttpError } from "@nojv/application";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import {
  assertJsonBodyWithinLimit,
  draftApiHandler,
  readJsonBody,
} from "$lib/server/shared/api-handler";

function parseContextParam(raw: string | null): unknown {
  if (raw === null) throw new HttpError("context is required.", 400);
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError("context must be JSON.", 400);
  }
}

export const GET: RequestHandler = draftApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const scope = codeDraftScopeSchema.parse({
    context: parseContextParam(event.url.searchParams.get("context")),
    problemId: event.url.searchParams.get("problemId"),
  });
  return json({ drafts: await codeDraftDomain.listCodeDrafts(actor, scope) });
});

export const PUT: RequestHandler = draftApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event, MAX_SUBMISSION_BODY_BYTES);
  const actor = requireApiAuth(event);
  const draft = codeDraftSaveSchema.parse(await readJsonBody(event, MAX_SUBMISSION_BODY_BYTES));
  return json(await codeDraftDomain.saveCodeDraft(actor, draft));
});
