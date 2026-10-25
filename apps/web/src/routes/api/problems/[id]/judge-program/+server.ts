import { codeDraftScopeSchema } from "@nojv/core";
import { problemDomain } from "@nojv/application";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "#lib/server/auth.js";
import { getClientIp } from "#lib/server/shared/client-ip.js";
import { apiHandler, parseJsonContextParam } from "#lib/server/shared/api-handler.js";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const { context, problemId } = codeDraftScopeSchema.parse({
    context: parseJsonContextParam(event.url.searchParams.get("context")),
    problemId: event.params.id,
  });
  return Response.json(
    await problemDomain.getJudgeProgramSource(actor, problemId, context, getClientIp(event)),
  );
});
