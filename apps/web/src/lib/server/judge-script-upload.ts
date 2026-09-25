import { error, json, type RequestEvent } from "@sveltejs/kit";
import { problemDomain } from "@nojv/application";
import { judgeScriptLanguageSchema } from "@nojv/core";

import { requireApiAuth } from "$lib/server/auth";

const MAX_SIZE = 5 * 1024 * 1024;

const SCRIPT_KINDS = {
  checker: { label: "Checker", save: problemDomain.setProblemChecker },
  interactor: { label: "Interactor", save: problemDomain.setProblemInteractor },
};

export async function uploadJudgeScript(
  event: RequestEvent,
  kind: keyof typeof SCRIPT_KINDS,
): Promise<Response> {
  const { label, save } = SCRIPT_KINDS[kind];
  const actor = requireApiAuth(event);

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  await problemDomain.assertProblemEditAccess(actor, problemId);

  const formData = await event.request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    error(400, `No ${kind} script provided`);
  }
  if (file.size > MAX_SIZE) {
    error(413, `${label} script too large (max ${String(MAX_SIZE / (1024 * 1024))} MB)`);
  }

  const language = judgeScriptLanguageSchema.safeParse(formData.get("language") ?? "");
  if (!language.success) {
    error(400, `Invalid ${kind} language (expected 'python' or 'cpp')`);
  }

  await problemDomain.assertProblemStorageBudget(problemId, file.size);

  const result = await save(actor, problemId, {
    content: await file.text(),
    language: language.data,
  });

  return json({ id: result.id });
}
