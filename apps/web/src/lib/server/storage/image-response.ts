import { error } from "@sveltejs/kit";
import { isStorageObjectNotFoundError } from "@nojv/storage";

export function immutableImageResponse(
  bytes: Uint8Array,
  contentType: string,
  headers: Record<string, string> = {},
): Response {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body.buffer, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": String(bytes.byteLength),
      "content-type": contentType,
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export async function storedImageResponse(
  read: () => Promise<{ body: Uint8Array; contentType: string }>,
  notFoundMessage: string,
): Promise<Response> {
  try {
    const image = await read();
    return immutableImageResponse(image.body, image.contentType);
  } catch (err) {
    if (isStorageObjectNotFoundError(err)) error(404, notFoundMessage);
    throw err;
  }
}
