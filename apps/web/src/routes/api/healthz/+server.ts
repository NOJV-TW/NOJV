import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { adminDomain } from "@nojv/domain";

export const GET: RequestHandler = async () => {
  const checks = await adminDomain.checkSystemHealth();
  const healthy = checks.postgres === "ok" && checks.redis === "ok";

  return json(
    { status: healthy ? "healthy" : "unhealthy", checks },
    { status: healthy ? 200 : 503 },
  );
};
