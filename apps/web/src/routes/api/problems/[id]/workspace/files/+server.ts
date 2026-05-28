import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { canEditProblem, problemDomain } from "@nojv/domain";

import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";

// Hard cap per uploaded workspace file. Aggregate per-problem usage is
// bounded separately by assertProblemStorageBudget (50 MB across testcases
// + workspace + validator scripts).
const MAX_WORKSPACE_FILE_SIZE = 5 * 1024 * 1024;

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  if (!canEditProblem(actor.platformRole)) {
    error(403, "Not authorized to edit problems");
  }

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  await problemDomain.assertProblemEditAccess(
    { platformRole: actor.platformRole, userId: actor.userId, username: actor.username },
    problemId,
  );

  // Pre-flight on the declared Content-Length so we reject obvious oversize
  // before reading the body off the wire. Post-read size check below still
  // runs because Content-Length is a hint, not a contract.
  const contentLength = Number(event.request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_WORKSPACE_FILE_SIZE * 2) {
    error(413, "File too large");
  }

  const formData = await event.request.formData();
  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    error(400, "file required");
  }
  if (file.size > MAX_WORKSPACE_FILE_SIZE) {
    error(413, "File too large");
  }

  const rawPath = formData.get("path");
  const rawLanguage = formData.get("language");
  const rawVisibility = formData.get("visibility");
  const path = typeof rawPath === "string" ? rawPath : "";
  const language = typeof rawLanguage === "string" ? rawLanguage : "";
  const visibility = typeof rawVisibility === "string" ? rawVisibility : "editable";

  await problemDomain.assertProblemStorageBudget(problemId, file.size);

  const content = await file.text();

  // setWorkspaceFile runs `problemWorkspaceFileSchema.parse(...)` which
  // bounces invalid language / visibility / path strings into a ZodError —
  // wrapHandler in api-handler.ts maps that to 400.
  await problemDomain.setWorkspaceFile(problemId, {
    language,
    path,
    visibility,
    content,
  });

  return json(await problemDomain.getProblemPageData(problemId));
});
