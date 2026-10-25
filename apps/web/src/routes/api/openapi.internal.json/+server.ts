import type { RequestHandler } from "./$types";

import { internalOpenApiDocument } from "#lib/server/openapi/internal-document.js";

export const GET: RequestHandler = ({ url }) => {
  return Response.json({ ...internalOpenApiDocument, servers: [{ url: url.origin }] });
};
