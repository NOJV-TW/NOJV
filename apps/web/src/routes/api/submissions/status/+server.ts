import { json } from "@sveltejs/kit";
import { z } from "zod";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { submissionDomain } from "@nojv/application";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const ids = z
    .array(z.string().min(1).max(128))
    .min(1)
    .max(100)
    .parse(event.url.searchParams.get("ids")?.split(","));
  return json(await submissionDomain.listSubmissionOperations(actor, ids));
});
