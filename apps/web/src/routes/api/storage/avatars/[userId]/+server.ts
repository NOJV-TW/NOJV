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
    const body = await readAvatar(params.userId);
    return new Response(toArrayBufferBody(body), {
      headers: {
        "cache-control": "public, max-age=300",
        "content-length": String(body.byteLength),
        "content-type": "image/webp",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    storageError(err);
  }
};
