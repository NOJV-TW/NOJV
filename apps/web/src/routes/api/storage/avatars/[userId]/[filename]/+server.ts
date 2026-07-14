import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { readAvatar } from "$lib/server/storage/avatar";
import { toArrayBufferBody } from "$lib/server/shared/response-body";

function storageError(err: unknown): never {
  if (err instanceof Error && err.name === "NoSuchKey") {
    error(404, "Avatar not found");
  }
  throw err;
}

export const GET: RequestHandler = async ({ params }) => {
  try {
    const { userId, filename } = params as { userId?: string; filename?: string };
    if (!userId || !filename) error(404, "Avatar not found");
    const body = await readAvatar(userId, filename);
    return new Response(toArrayBufferBody(body), {
      headers: {
        "cache-control": "public, max-age=31536000, immutable",
        "content-length": String(body.byteLength),
        "content-type": "image/webp",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    storageError(err);
  }
};
