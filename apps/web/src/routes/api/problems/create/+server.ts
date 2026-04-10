import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import type { ProblemType } from "@nojv/core";
import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { problemDomain } from "@nojv/domain";

const { createProblemRecord } = problemDomain;

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  if (actor.platformRole === "student" && !actor.emailVerified) {
    error(403, "Verify school email first");
  }

  // Clients send `mode: "standard" | "advanced"` for back-compat with
  // the previous URL shape. Translate into the new `ProblemType` value.
  let type: ProblemType = "full_source";
  try {
    const body = (await event.request.json().catch(() => null)) as {
      mode?: unknown;
    } | null;
    if (body?.mode === "advanced") type = "special_env";
  } catch {
    // ignore — GET / no body is fine, defaults to full_source
  }

  const result = await createProblemRecord(actor, {
    difficulty: "medium",
    inputFormat: "",
    memoryLimitMb: 256,
    networkEnabled: false,
    outputFormat: "",
    statement: "",
    status: "draft",
    tags: [],
    timeLimitMs: 1000,
    title: "Untitled Problem",
    type,
    visibility: "private"
  });

  // The response field is still called `mode` — Tabs.svelte branches on
  // it to pick the next route. Keep the contract stable.
  return json({ id: result.id, mode: type === "special_env" ? "advanced" : "standard" });
});
