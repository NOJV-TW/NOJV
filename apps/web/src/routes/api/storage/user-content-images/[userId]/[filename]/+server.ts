import type { RequestHandler } from "./$types";
import { storedImageResponse } from "$lib/server/storage/image-response";
import { readUserContentImage } from "$lib/server/storage/user-content-image";

export const GET: RequestHandler = ({ params }) =>
  storedImageResponse(
    () => readUserContentImage(params.userId, params.filename),
    "Image not found",
  );
