import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { tokenOpenApiDocument } from "$lib/server/openapi/token-document";

export const GET: RequestHandler = ({ url }) => {
  return json({ ...tokenOpenApiDocument, servers: [{ url: url.origin }] });
};
