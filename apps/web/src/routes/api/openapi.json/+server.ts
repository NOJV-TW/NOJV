import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { openApiDocument } from "$lib/server/openapi/document";

export const GET: RequestHandler = () => {
  return json(openApiDocument);
};
