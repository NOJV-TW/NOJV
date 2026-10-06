import {
  TEST_JUDGE_REQUEST_BODY_BYTES,
  testJudgeErrorCodes,
  testJudgeRequestSchema,
} from "@nojv/core";
import { HttpError, ServiceUnavailableError, testJudgeDomain } from "@nojv/application";
import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import {
  assertJsonBodyWithinLimit,
  readJsonBody,
  testJudgeApiHandler,
} from "$lib/server/shared/api-handler";
import { getClientIp } from "$lib/server/shared/client-ip";

const testJudgeCodes: ReadonlySet<string> = new Set(testJudgeErrorCodes);

export const POST: RequestHandler = testJudgeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const { id } = event.params;
  if (!id) return json({ message: "Missing problem ID." }, { status: 400 });
  assertJsonBodyWithinLimit(event, TEST_JUDGE_REQUEST_BODY_BYTES);

  try {
    return json(
      await testJudgeDomain.withUserTestJudgeLock(actor.userId, async () => {
        const request = testJudgeRequestSchema.parse(
          await readJsonBody(event, TEST_JUDGE_REQUEST_BODY_BYTES),
        );
        return testJudgeDomain.runTestJudge(actor, id, request, getClientIp(event));
      }),
    );
  } catch (err) {
    if (
      err instanceof HttpError &&
      ((err.status >= 400 && err.status < 500) || err instanceof ServiceUnavailableError)
    ) {
      const code = testJudgeCodes.has(err.message) ? err.message : "test_rejected";
      return json({ code, message: err.message }, { status: err.status });
    }
    throw err;
  }
});
