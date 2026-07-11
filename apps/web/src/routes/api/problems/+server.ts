import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import type { ProblemType } from "@nojv/core";
import { requireApiAuth } from "$lib/server/auth";
import {
  apiHandler,
  writeApiHandler,
  assertJsonBodyWithinLimit,
  readJsonBody,
} from "$lib/server/shared/api-handler";
import { isAdvancedModeSupported } from "$lib/server/execution-backend";
import { parseProblemListQuery } from "$lib/server/shared/problem-list-query";
import { problemDomain } from "@nojv/application";

const { createProblemRecord, listProblemCards } = problemDomain;

export const GET: RequestHandler = apiHandler(async (event) => {
  const params = parseProblemListQuery(event.url);
  const result = await listProblemCards({ ...params, userId: event.locals.user?.id ?? null });
  return json(result);
});

export const POST: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);

  if (!(await problemDomain.canAuthorProblems(actor))) {
    error(403, "Not authorized to create problems");
  }

  const body = (await readJsonBody(event).catch(() => null)) as {
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
