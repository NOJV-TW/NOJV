import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { adminDomain } from "@nojv/domain";

// Public LB probe. Status code carries the signal (200 healthy / 503 not).
// Body intentionally minimal — internal topology (which subsystem is down)
// is admin-only via `/api/admin/healthz` to avoid leaking it to unauth callers.
export const GET: RequestHandler = async () => {
  const checks = await adminDomain.checkSystemHealth();
  const healthy = checks.postgres === "ok" && checks.redis === "ok";

  return json({ ok: healthy }, { status: healthy ? 200 : 503 });
};
