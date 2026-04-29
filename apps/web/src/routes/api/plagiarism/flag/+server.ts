import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { plagiarismDomain } from "@nojv/domain";
import { writeApiHandler } from "$lib/server/shared/api-handler";

const { flagPair, buildPairKey } = plagiarismDomain;

const flagBodySchema = z.object({
  contextType: z.enum(["assessment", "exam", "contest"]),
  contextId: z.string().min(1),
  problemId: z.string().min(1),
  userAId: z.string().min(1),
  userBId: z.string().min(1),
  note: z.string().max(2000).optional().nullable(),
});

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const body = (await event.request.json()) as unknown;
  const parsed = flagBodySchema.parse(body);

  // Server sorts the user ids — clients can never invert the pair.
  const pairKey = buildPairKey(parsed.userAId, parsed.userBId, parsed.problemId);

  const flag = await flagPair(actor, {
    contextType: parsed.contextType,
    contextId: parsed.contextId,
    pairKey,
    note: parsed.note ?? null,
  });

  return json({ flag });
});
