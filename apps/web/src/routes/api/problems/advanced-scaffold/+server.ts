import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { problemDomain } from "@nojv/application";
import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { buildScaffoldZip, scaffoldZipFilename } from "$lib/server/advanced-scaffold";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  if (!(await problemDomain.canCreateAdvancedProblems(actor))) {
    error(403, "Advanced-mode problem authoring requires permission from an administrator.");
  }

  const zip = await buildScaffoldZip();

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${scaffoldZipFilename()}"`,
      "cache-control": "no-store",
    },
  });
});
