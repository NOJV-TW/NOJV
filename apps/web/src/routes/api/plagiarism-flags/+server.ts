import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { plagiarismDomain } from "@nojv/application";
import { plagiarismFlagCreateSchema } from "@nojv/core";
import {
  writeApiHandler,
  assertJsonBodyWithinLimit,
  readJsonBody,
} from "$lib/server/shared/api-handler";

const { flagPair, buildPairKey } = plagiarismDomain;

export const POST: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const body = await readJsonBody(event);
  const parsed = plagiarismFlagCreateSchema.parse(body);

  const pairKey = buildPairKey(parsed.userAId, parsed.userBId, parsed.problemId);

  const flag = await flagPair(actor, {
    contextType: parsed.contextType,
    contextId: parsed.contextId,
    pairKey,
    note: parsed.note ?? null,
  });

  return json({ flag });
});
