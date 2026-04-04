import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "$lib/server/auth";
import { problemDomain } from "@nojv/domain";

const { createProblemRecord } = problemDomain;

export const POST: RequestHandler = async (event) => {
  const actor = requireApiAuth(event);

  if (actor.platformRole === "student" && !actor.emailVerified) {
    error(403, "Verify school email first");
  }

  const result = await createProblemRecord(actor, {
    difficulty: "medium",
    inputFormat: "",
    memoryLimitMb: 256,
    outputFormat: "",
    statement: "",
    status: "draft",
    submissionType: "full_source",
    summary: "",
    tags: [],
    templates: [],
    timeLimitMs: 1000,
    title: "Untitled Problem",
    visibility: "private"
  });

  return json({ id: result.id });
};
