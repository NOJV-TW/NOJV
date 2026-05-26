import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import type { ProblemType } from "@nojv/core";
import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { isAdvancedModeSupported } from "$lib/server/execution-backend";
import { canEditProblem, problemDomain } from "@nojv/domain";

const { createProblemRecord } = problemDomain;

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  if (!canEditProblem(actor.platformRole)) {
    error(403, "Not authorized to create problems");
  }

  // Clients send `mode: "standard" | "advanced"` for back-compat with
  // the previous URL shape. Translate into the new `ProblemType` value.
  let mode: unknown;
  try {
    const body = (await event.request.json().catch(() => null)) as {
      mode?: unknown;
    } | null;
    mode = body?.mode;
  } catch {
    // missing/invalid body falls through to the default ProblemType
  }

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

  // The response field is still called `mode` — Tabs.svelte branches on
  // it to pick the next route. Keep the contract stable.
  return json({ id: result.id, mode: type === "special_env" ? "advanced" : "standard" });
});
