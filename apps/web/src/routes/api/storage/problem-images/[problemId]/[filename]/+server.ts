import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { readProblemImage } from "$lib/server/storage/problem-image";
import { toArrayBufferBody } from "$lib/server/shared/response-body";

function storageError(err: unknown): never {
  if (err instanceof Error && err.name === "NoSuchKey") {
    error(404, "Image not found");
  }
  throw err;
}

export const GET: RequestHandler = async ({ params }) => {
  try {
    const image = await readProblemImage(params.problemId, params.filename);
    return new Response(toArrayBufferBody(image.body), {
      headers: {
        "cache-control": "public, max-age=31536000, immutable",
        "content-length": String(image.body.byteLength),
        "content-type": image.contentType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    storageError(err);
  }
};
