import type { RequestHandler } from "./$types";
import { uploadJudgeScript } from "$lib/server/judge-script-upload";
import { writeApiHandler } from "$lib/server/shared/api-handler";

export const POST: RequestHandler = writeApiHandler((event) =>
  uploadJudgeScript(event, "interactor"),
);
