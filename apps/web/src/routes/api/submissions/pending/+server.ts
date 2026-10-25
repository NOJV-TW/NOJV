import { z } from "zod";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "#lib/server/auth.js";
import { apiHandler } from "#lib/server/shared/api-handler.js";
import { submissionDomain } from "@nojv/application";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const cursor = z
    .string()
    .min(1)
    .max(128)
    .optional()
    .parse(event.url.searchParams.get("cursor") ?? undefined);
  return Response.json(await submissionDomain.listPendingSubmissionOperations(actor, cursor));
});
