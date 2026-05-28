import { error, json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";
import { problemDomain } from "@nojv/domain";

// Upload cap: 60 MB raw zip bytes. Leaves headroom over the 50 MB
// UNcompressed budget that `importBundle` enforces after parsing — zip
// compresses text well, so 60 MB compressed easily exceeds 50 MB
// uncompressed in pathological cases. The route rejects oversized
// requests cheaply (before unzipping) so a hostile uploader can't
// pin worker memory by sending a 1 GB stream.
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

/**
 * POST /api/problems/[id]/bundle
 *
 * Replace this problem's testcase sets, workspace files, and checker /
 * interactor scripts from a single zip archive. Bundle format:
 *
 *   testcases/<N>/input.txt
 *   testcases/<N>/answer.txt
 *   workspace/<path>          (language inferred from extension)
 *   checker.<cpp|py>
 *   interactor.<cpp|py>
 *
 * Caller must hold problem-edit access (author or admin); the per-problem
 * 50 MB storage budget is enforced by the domain helper.
 */
export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  // Cheap upfront rejection by Content-Length when the client supplies one.
  // Hostile clients can lie about the header; the arrayBuffer() read below
  // is the authoritative byte-count check.
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

/**
 * GET /api/problems/[id]/bundle
 *
 * Stream this problem's testcases, workspace files, and checker / interactor
 * scripts back to the client as a zip in the same layout the POST handler
 * imports. Caller must hold problem-edit access — script bodies are
 * author/admin-only.
 */
export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  const buf = await problemDomain.exportBundle(
    { platformRole: actor.platformRole, userId: actor.userId, username: actor.username },
    problemId,
  );

  // Wrap in a Blob — Node's `Buffer` is typed against `ArrayBufferLike`
  // (which includes `SharedArrayBuffer`) and the DOM `Response` typing
  // svelte-check uses wants a strict `ArrayBuffer`. Copy through a fresh
  // Uint8Array so the underlying buffer is an `ArrayBuffer` proper.
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  const body = new Blob([copy], { type: "application/zip" });

  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="problem-${problemId}.zip"`,
    },
  });
});
