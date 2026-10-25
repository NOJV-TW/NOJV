import type { RequestHandler } from "./$types";

import { tokenOpenApiDocument } from "#lib/server/openapi/token-document.js";

export const GET: RequestHandler = ({ url }) => {
  return Response.json({ ...tokenOpenApiDocument, servers: [{ url: url.origin }] });
};
