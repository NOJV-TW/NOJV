import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { internalOpenApiDocument } from "$lib/server/openapi/internal-document";

export const GET: RequestHandler = ({ url }) => {
  return json({ ...internalOpenApiDocument, servers: [{ url: url.origin }] });
};
