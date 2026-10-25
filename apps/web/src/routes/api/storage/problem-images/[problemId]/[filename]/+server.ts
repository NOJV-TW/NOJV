import type { RequestHandler } from "./$types";
import { storedImageResponse } from "#lib/server/storage/image-response.js";
import { readProblemImage } from "#lib/server/storage/problem-image.js";

export const GET: RequestHandler = ({ params }) =>
  storedImageResponse(
    () => readProblemImage(params.problemId, params.filename),
    "Image not found",
  );
