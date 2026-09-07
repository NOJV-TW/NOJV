import { json } from "@sveltejs/kit";
import type { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import {
  apiHandler,
  writeApiHandler,
  assertJsonBodyWithinLimit,
  readJsonBody,
} from "$lib/server/shared/api-handler";
import { scoreOverrideDomain } from "@nojv/application";
import {
  scoreOverrideContextSchema as contextSchema,
  scoreOverrideCreateSchema,
} from "@nojv/core";

function parseContextQuery(url: URL): z.infer<typeof contextSchema> {
  const type = url.searchParams.get("type");
  if (type === "assignment") {
    return contextSchema.parse({ type, assignmentId: url.searchParams.get("assignmentId") });
  }
  if (type === "exam") {
    return contextSchema.parse({ type, examId: url.searchParams.get("examId") });
  }
  if (type === "contest") {
    return contextSchema.parse({ type, contestId: url.searchParams.get("contestId") });
  }
  return contextSchema.parse({ type });
}

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const context = parseContextQuery(event.url);

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
