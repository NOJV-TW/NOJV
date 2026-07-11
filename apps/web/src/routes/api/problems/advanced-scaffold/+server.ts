import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { buildScaffoldZip, scaffoldZipFilename } from "$lib/server/advanced-scaffold";
import { isAdvancedZipUploadEnabled } from "$lib/server/execution-backend";

export const GET: RequestHandler = apiHandler(async (event) => {
  if (!isAdvancedZipUploadEnabled()) {
    error(404, "Not found");
  }
  requireApiAuth(event);

  const zip = await buildScaffoldZip();

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${scaffoldZipFilename()}"`,
      "cache-control": "no-store",
    },
  });
});
