import { z } from "zod";
import { json } from "@sveltejs/kit";
import { languageSchema, type Language } from "@nojv/core";

import type { RequestHandler } from "./$types";

import { HttpError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { problemDomain } from "@nojv/domain";

const { updateEditorial, softDeleteEditorial } = problemDomain;

// Mirrors the inline `editorialSubmitSchema` content bounds at the POST
// route so update + create stay in sync; both fields optional so the
// caller can send a partial payload.
const editorialUpdateSchema = z
  .object({
    content: z.string().min(10).max(50000).optional(),
    language: languageSchema.optional(),
  })
  .refine((value) => value.content !== undefined || value.language !== undefined, {
    message: "At least one field (content or language) is required.",
  });

function requireId(event: { params: { id?: string } }): string {
  const id = event.params.id;
  if (!id) throw new HttpError("Editorial id is required.", 400);
  return id;
}

export const PATCH: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const id = requireId(event);
  const payload = editorialUpdateSchema.parse(await event.request.json());

  // Pass only keys that were actually provided — `exactOptionalPropertyTypes`
  // forbids forwarding `undefined` for optional fields.
  const input: { content?: string; language?: Language } = {};
  if (payload.content !== undefined) input.content = payload.content;
  if (payload.language !== undefined) input.language = payload.language;
  const updated = await updateEditorial(actor, id, input);
  return json(updated);
});

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const id = requireId(event);

  await softDeleteEditorial(actor, id);
  return json({ ok: true });
});
