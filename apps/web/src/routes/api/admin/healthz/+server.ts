import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { adminDomain } from "@nojv/application";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  if (actor.platformRole !== "admin") {
    return json({ message: "Forbidden" }, { status: 403 });
  }

  const checks = await adminDomain.checkSystemHealth();
  const healthy = checks.postgres === "ok" && checks.redis === "ok";

  return json(
    { status: healthy ? "healthy" : "unhealthy", checks },
    { status: healthy ? 200 : 503 },
  );
});
