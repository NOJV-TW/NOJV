import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { HttpError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { clarificationDomain } from "@nojv/domain";

const CANNED_TEMPLATES = {
  noComment: "No comment.",
  readProblem: "Please re-read the problem statement.",
  yes: "Yes.",
  no: "No.",
} as const;

const cannedSchema = z.object({
  templateKey: z.enum(["noComment", "readProblem", "yes", "no"]),
});

function requireId(event: RequestEvent): string {
  const id = event.params.id;
  if (!id) throw new HttpError("Clarification id is required.", 400);
  return id;
}

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const id = requireId(event);
  const body = cannedSchema.parse(await event.request.json());

  const answerText = CANNED_TEMPLATES[body.templateKey];
  const updated = await clarificationDomain.answer(actor, id, { answerText });
  return json(updated);
});
