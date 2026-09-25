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
import { scoreOverrideDomain } from "@nojv/application";
import {
  scoreOverrideContextSchema as contextSchema,
  scoreOverrideCreateSchema,
} from "@nojv/core";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const context = parseContextQuery(event.url, contextSchema);

  await scoreOverrideDomain.assertCanViewScoreOverrides(actor, context);

  const items = await scoreOverrideDomain.listByContext(context);
  return json({ items });
});

export const POST: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const body = scoreOverrideCreateSchema.parse(await readJsonBody(event));

  const row = await scoreOverrideDomain.createOverride(actor, body);
  return json(row, { status: 201 });
});
