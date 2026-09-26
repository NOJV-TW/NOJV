import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import {
  apiHandler,
  writeApiHandler,
  assertJsonBodyWithinLimit,
  parseContextQuery,
  readJsonBody,
} from "$lib/server/shared/api-handler";
import { feedbackUpsertSchema, scoreOverrideContextSchema as contextSchema } from "@nojv/core";
import { feedbackDomain } from "@nojv/application";

const upsertSchema = feedbackUpsertSchema.extend({ context: contextSchema });

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const context = parseContextQuery(event.url, contextSchema);

  await feedbackDomain.assertCanViewFeedback(actor, context);

  const items = await feedbackDomain.listFeedbackForContext(context);
  return json({ items });
});

export const PUT: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const { context, ...input } = upsertSchema.parse(await readJsonBody(event));

  const row = await feedbackDomain.upsertFeedback(actor, { context, input });
  return json(row);
});
