import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { adminDomain } from "@nojv/domain";

// Postgres + Redis are critical: their failure flips the HTTP status to 503
// so load balancers will pull the pod. Temporal is informational — the web
// process can still serve reads when Temporal is unreachable, so we surface
// `temporal: "down: ..."` in the body and keep the HTTP status at 200.
export const GET: RequestHandler = async () => {
  const checks = await adminDomain.checkSystemHealth();
  const healthy = checks.postgres === "ok" && checks.redis === "ok";

  return json(
    { status: healthy ? "healthy" : "unhealthy", checks },
    { status: healthy ? 200 : 503 },
  );
};
