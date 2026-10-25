import type { RequestHandler } from "./$types";
import { uploadJudgeScript } from "#lib/server/judge-script-upload.js";
import { writeApiHandler } from "#lib/server/shared/api-handler.js";

export const POST: RequestHandler = writeApiHandler((event) =>
  uploadJudgeScript(event, "checker"),
);
