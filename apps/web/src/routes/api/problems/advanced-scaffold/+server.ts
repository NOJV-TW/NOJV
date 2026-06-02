import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { buildScaffoldZip, SCAFFOLD_ZIP_FILENAME } from "$lib/server/advanced-scaffold";

export const GET: RequestHandler = apiHandler(async (event) => {
  requireApiAuth(event);

  const zip = await buildScaffoldZip();

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${SCAFFOLD_ZIP_FILENAME}"`,
      "cache-control": "no-store",
    },
  });
});
