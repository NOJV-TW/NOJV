import type { RequestHandler } from "./$types";
import { storedImageResponse } from "$lib/server/storage/image-response";
import { readProblemImage } from "$lib/server/storage/problem-image";

export const GET: RequestHandler = ({ params }) =>
  storedImageResponse(
    () => readProblemImage(params.problemId, params.filename),
    "Image not found",
  );
