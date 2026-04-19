import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";
import { scoreOverrideDomain } from "@nojv/domain";

const contextTypeSchema = z.enum(["assignment", "exam", "contest"]);

const listQuerySchema = z.object({
  contextType: contextTypeSchema,
  contextId: z.string().min(1)
});

const createSchema = z.object({
  userId: z.string().min(1),
  problemId: z.string().min(1),
  contextType: contextTypeSchema,
  contextId: z.string().min(1),
  overrideScore: z.number().int().min(0),
  reason: z.string().min(1).max(500)
});

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const parsed = listQuerySchema.parse({
    contextType: event.url.searchParams.get("contextType"),
    contextId: event.url.searchParams.get("contextId")
  });

  // Listing surfaces the staff-only `reason` field, so gate on the same
  // permission required to set overrides — students must never reach this.
  await scoreOverrideDomain.assertCanSetScoreOverride(
    actor,
    parsed.contextType,
    parsed.contextId
  );

  const items = await scoreOverrideDomain.listByContext(parsed.contextType, parsed.contextId);
  return json({ items });
});

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const body = createSchema.parse(await event.request.json());

  const row = await scoreOverrideDomain.createOverride(actor, body);
  return json(row, { status: 201 });
});
