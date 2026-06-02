import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { HttpError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { clarificationDomain } from "@nojv/domain";

const patchSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("answer"),
    answerText: z.string().min(1).max(1000),
  }),
  z.object({
    kind: z.literal("dismiss"),
  }),
]);

function parseBody(raw: unknown): z.infer<typeof patchSchema> {
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (obj.kind === undefined) {
      if (obj.state === "dismissed") return patchSchema.parse({ kind: "dismiss" });
      if (typeof obj.answerText === "string") {
        return patchSchema.parse({ kind: "answer", answerText: obj.answerText });
      }
    }
  }
  return patchSchema.parse(raw);
}

function requireId(event: RequestEvent): string {
  const id = event.params.id;
  if (!id) throw new HttpError("Clarification id is required.", 400);
  return id;
}

export const PATCH: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const id = requireId(event);
  const parsed = parseBody(await event.request.json());

  if (parsed.kind === "dismiss") {
    const updated = await clarificationDomain.dismiss(actor, id);
    return json(updated);
  }

  const updated = await clarificationDomain.answer(actor, id, {
    answerText: parsed.answerText,
  });
  return json(updated);
});

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const id = requireId(event);

  await clarificationDomain.deleteClarification(actor, id);
  return new Response(null, { status: 204 });
});
