import type { RequestHandler } from "./$types";
import { storedImageResponse } from "#lib/server/storage/image-response.js";
import { readUserContentImage } from "#lib/server/storage/user-content-image.js";

export const GET: RequestHandler = ({ params }) =>
  storedImageResponse(
    () => readUserContentImage(params.userId, params.filename),
    "Image not found",
  );
