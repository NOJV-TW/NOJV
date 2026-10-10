import { json } from "@sveltejs/kit";
import { codeDraftScopeSchema } from "@nojv/core";
import { problemDomain } from "@nojv/application";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { getClientIp } from "$lib/server/shared/client-ip";
import { apiHandler, parseJsonContextParam } from "$lib/server/shared/api-handler";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const { context, problemId } = codeDraftScopeSchema.parse({
    context: parseJsonContextParam(event.url.searchParams.get("context")),
    problemId: event.params.id,
  });
  return json(
    await problemDomain.getJudgeProgramSource(actor, problemId, context, getClientIp(event)),
  );
});
