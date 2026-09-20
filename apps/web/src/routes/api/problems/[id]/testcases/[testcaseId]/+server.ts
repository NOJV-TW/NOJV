import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { problemDomain } from "@nojv/application";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const problemId = event.params.id;
  const testcaseId = event.params.testcaseId;
  if (!problemId || !testcaseId) error(400, "Missing problem or testcase id");

  const content = await problemDomain.getTestcaseContent(
    { platformRole: actor.platformRole, userId: actor.userId, username: actor.username },
    problemId,
    testcaseId,
  );

  return json(content);
});
