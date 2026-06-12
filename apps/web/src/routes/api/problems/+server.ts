import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import type { ProblemType } from "@nojv/core";
import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler, assertJsonBodyWithinLimit } from "$lib/server/shared/api-handler";
import { isAdvancedModeSupported } from "$lib/server/execution-backend";
import { canCreateProblem, problemDomain } from "@nojv/domain";

const { createProblemRecord } = problemDomain;

export const POST: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);

  if (!canCreateProblem(actor.platformRole, actor.emailVerified)) {
    error(403, "Not authorized to create problems");
  }

  const body = (await event.request.json().catch(() => null)) as {
    mode?: unknown;
  } | null;
  const mode = body?.mode;

  let type: ProblemType = "full_source";
  if (mode === "advanced") {
    if (!isAdvancedModeSupported()) {
      error(400, "Advanced-mode problems require the Docker execution backend.");
    }
    type = "special_env";
  }

  const result = await createProblemRecord(actor, {
    difficulty: "medium",
    inputFormat: "",
    memoryLimitMb: 256,
    outputFormat: "",
    statement: "",
    status: "draft",
    tags: [],
    timeLimitMs: 1000,
    title: "Untitled Problem",
    type,
    visibility: "private",
  });

  return json({ id: result.id, mode: type === "special_env" ? "advanced" : "standard" });
});
