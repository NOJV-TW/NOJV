import { error, json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";
import { problemDomain } from "@nojv/application";

const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");
  await problemDomain.assertProblemEditAccess(actor, problemId);

  const declared = Number(event.request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    error(413, `Bundle exceeds ${String(MAX_UPLOAD_BYTES)} bytes`);
  }

  const arr = await event.request.arrayBuffer();
  if (arr.byteLength === 0) error(400, "Empty bundle");
  if (arr.byteLength > MAX_UPLOAD_BYTES) {
    error(413, `Bundle exceeds ${String(MAX_UPLOAD_BYTES)} bytes`);
  }

  const result = await problemDomain.importBundle(actor, problemId, Buffer.from(arr));

  return json(result);
});

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  const stream = await problemDomain.exportBundle(actor, problemId);

  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="problem-${problemId}.zip"`,
    },
  });
});
