import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { problemDomain } from "@nojv/application";
import { judgeScriptLanguageSchema } from "@nojv/core";

const MAX_SIZE = 5 * 1024 * 1024;

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  const actorContext = {
    platformRole: actor.platformRole,
    userId: actor.userId,
    username: actor.username,
  };
  await problemDomain.assertProblemEditAccess(actorContext, problemId);

  const formData = await event.request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    error(400, "No checker script provided");
  }
  if (file.size > MAX_SIZE) {
    error(413, `Checker script too large (max ${String(MAX_SIZE / (1024 * 1024))} MB)`);
  }

  const rawLanguage = formData.get("language");
  const languageRaw = typeof rawLanguage === "string" ? rawLanguage : "";
  const languageParse = judgeScriptLanguageSchema.safeParse(languageRaw);
  if (!languageParse.success) {
    error(400, "Invalid checker language (expected 'python' or 'cpp')");
  }

  await problemDomain.assertProblemStorageBudget(problemId, file.size);

  const content = await file.text();

  const result = await problemDomain.setProblemChecker(actorContext, problemId, {
    content,
    language: languageParse.data,
  });

  return json({ id: result.id });
});
