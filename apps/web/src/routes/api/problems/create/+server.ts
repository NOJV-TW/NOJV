import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { problemDomain } from "@nojv/domain";

const { createProblemRecord } = problemDomain;

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  if (actor.platformRole === "student" && !actor.emailVerified) {
    error(403, "Verify school email first");
  }

  let mode: "standard" | "advanced" = "standard";
  try {
    const body = (await event.request.json().catch(() => null)) as { mode?: unknown } | null;
    if (body?.mode === "advanced") mode = "advanced";
  } catch {
    // ignore — GET / no body is fine, defaults to standard
  }

  const result = await createProblemRecord(actor, {
    difficulty: "medium",
    inputFormat: "",
    memoryLimitMb: 256,
    mode,
    outputFormat: "",
    statement: "",
    status: "draft",
    submissionType: "full_source",
    summary: "",
    tags: [],
    timeLimitMs: 1000,
    title: "Untitled Problem",
    visibility: "private"
  });

  return json({ id: result.id, mode });
});
