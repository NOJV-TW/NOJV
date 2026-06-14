import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import {
  buildScaffoldZip,
  isScaffoldRole,
  scaffoldZipFilename,
} from "$lib/server/advanced-scaffold";

export const GET: RequestHandler = apiHandler(async (event) => {
  requireApiAuth(event);

  const role = event.url.searchParams.get("role") ?? "run";
  if (!isScaffoldRole(role)) {
    error(400, "role must be one of run|grade|service");
  }

  const zip = await buildScaffoldZip(role);

  return new Response(zip, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${scaffoldZipFilename(role)}"`,
      "cache-control": "no-store",
    },
  });
});
