import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import {
  writeApiHandler,
  assertJsonBodyWithinLimit,
  readJsonBody,
} from "$lib/server/shared/api-handler";
import { clarificationDomain, HttpError } from "@nojv/application";
import { clarificationPatchSchema } from "@nojv/core";
import type { ClarificationPatchInput } from "@nojv/core";

function parseBody(raw: unknown): ClarificationPatchInput {
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (obj.kind === undefined) {
      if (obj.state === "dismissed") return clarificationPatchSchema.parse({ kind: "dismiss" });
      if (typeof obj.answerText === "string") {
        return clarificationPatchSchema.parse({
          kind: "answer",
          answerText: obj.answerText,
          isPublic: obj.isPublic,
        });
      }
    }
  }
  return clarificationPatchSchema.parse(raw);
}

function requireId(event: RequestEvent): string {
  const id = event.params.id;
  if (!id) throw new HttpError("Clarification id is required.", 400);
  return id;
}

export const PATCH: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const id = requireId(event);
  const parsed = parseBody(await readJsonBody(event));

  if (parsed.kind === "dismiss") {
    const updated = await clarificationDomain.dismiss(actor, id);
    return json(updated);
  }

  const updated = await clarificationDomain.answer(actor, id, {
    answerText: parsed.answerText,
    isPublic: parsed.isPublic,
  });
  return json(updated);
});

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const id = requireId(event);

  await clarificationDomain.deleteClarification(actor, id);
  return new Response(null, { status: 204 });
});
