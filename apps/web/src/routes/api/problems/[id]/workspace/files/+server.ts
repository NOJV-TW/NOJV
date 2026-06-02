import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { canCreateProblem, problemDomain } from "@nojv/domain";

import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";

const MAX_WORKSPACE_FILE_SIZE = 5 * 1024 * 1024;

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  if (!canCreateProblem(actor.platformRole, actor.emailVerified)) {
    error(403, "Not authorized to edit problems");
  }

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  await problemDomain.assertProblemEditAccess(
    { platformRole: actor.platformRole, userId: actor.userId, username: actor.username },
    problemId,
  );

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

  await problemDomain.setWorkspaceFile(problemId, {
    language,
    path,
    visibility,
    content,
  });

  return json(await problemDomain.getProblemPageData(problemId));
});
