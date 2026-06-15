import { error, json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";
import { canCreateProblem, problemDomain } from "@nojv/application";

const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  if (!canCreateProblem(actor.platformRole, actor.emailVerified)) {
    error(403, "Not authorized to edit problems");
  }

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  const declared = Number(event.request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    error(413, `Bundle exceeds ${String(MAX_UPLOAD_BYTES)} bytes`);
  }

  const arr = await event.request.arrayBuffer();
  if (arr.byteLength === 0) error(400, "Empty bundle");
  if (arr.byteLength > MAX_UPLOAD_BYTES) {
    error(413, `Bundle exceeds ${String(MAX_UPLOAD_BYTES)} bytes`);
  }

  const result = await problemDomain.importBundle(
    { platformRole: actor.platformRole, userId: actor.userId, username: actor.username },
    problemId,
    Buffer.from(arr),
  );

  return json(result);
});

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  if (!canCreateProblem(actor.platformRole, actor.emailVerified)) {
    error(403, "Not authorized to edit problems");
  }

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  const stream = await problemDomain.exportBundle(
    { platformRole: actor.platformRole, userId: actor.userId, username: actor.username },
    problemId,
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="problem-${problemId}.zip"`,
    },
  });
});
