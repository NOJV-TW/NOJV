import { json } from "@sveltejs/kit";
import {
  codeDraftSaveSchema,
  codeDraftScopeSchema,
  MAX_SUBMISSION_BODY_BYTES,
} from "@nojv/core";
import { codeDraftDomain } from "@nojv/application";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { getClientIp } from "$lib/server/shared/client-ip";
import {
  assertJsonBodyWithinLimit,
  draftApiHandler,
  parseContextParam,
  readJsonBody,
} from "$lib/server/shared/api-handler";

export const GET: RequestHandler = draftApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const scope = codeDraftScopeSchema.parse({
    context: parseContextParam(event.url.searchParams.get("context")),
    problemId: event.url.searchParams.get("problemId"),
  });
  return json({
    drafts: await codeDraftDomain.listCodeDrafts(actor, scope, getClientIp(event)),
  });
});

export const PUT: RequestHandler = draftApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event, MAX_SUBMISSION_BODY_BYTES);
  const actor = requireApiAuth(event);
  const draft = codeDraftSaveSchema.parse(await readJsonBody(event, MAX_SUBMISSION_BODY_BYTES));
  return json(await codeDraftDomain.saveCodeDraft(actor, draft, getClientIp(event)));
});
