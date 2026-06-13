import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { adminDomain } from "@nojv/application";

const CACHE_TTL_MS = 5000;

type HealthChecks = Awaited<ReturnType<typeof adminDomain.checkSystemHealth>>;
let cached: { at: number; ok: boolean; checks: HealthChecks } | null = null;
let inflight: Promise<{ ok: boolean; checks: HealthChecks }> | null = null;

async function probe(): Promise<{ ok: boolean; checks: HealthChecks }> {
  const checks = await adminDomain.checkSystemHealth();
  const ok = checks.postgres === "ok" && checks.redis === "ok";
  return { ok, checks };
}

export const GET: RequestHandler = async () => {
  const now = Date.now();
  if (!cached || now - cached.at > CACHE_TTL_MS) {
    inflight ??= probe().finally(() => {
      inflight = null;
    });
    const result = await inflight;
    cached = { at: Date.now(), ...result };
  }
  return json({ ok: cached.ok, checks: cached.checks }, { status: cached.ok ? 200 : 503 });
};
