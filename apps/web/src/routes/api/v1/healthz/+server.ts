import { json, type RequestHandler } from "@sveltejs/kit";
import { adminDomain } from "@nojv/domain";

// Public API health probe. Status code carries the signal:
// 200 healthy / 503 unhealthy.
//
// Body intentionally stays minimal. Detailed subsystem status remains
// admin-only via `/api/admin/healthz`.
export const GET: RequestHandler = async () => {
  const checks = await adminDomain.checkSystemHealth();
  const healthy = checks.postgres === "ok" && checks.redis === "ok";

  return json({ ok: healthy }, { status: healthy ? 200 : 503 });
};