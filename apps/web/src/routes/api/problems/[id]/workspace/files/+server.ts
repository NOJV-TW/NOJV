import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { problemDomain } from "@nojv/application";

import { requireApiAuth } from "$lib/server/auth";
import { readFormData, writeApiHandler } from "$lib/server/shared/api-handler";

const MAX_WORKSPACE_FILE_SIZE = 5 * 1024 * 1024;

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  await problemDomain.assertProblemEditAccess(actor, problemId);

  const formData = await readFormData(event, MAX_WORKSPACE_FILE_SIZE + 64 * 1024);
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

  const content = await file.text();

  await problemDomain.setWorkspaceFile(actor, problemId, {
    language,
    path,
    visibility,
    content,
  });

  return json(await problemDomain.getProblemPageData(problemId));
});
