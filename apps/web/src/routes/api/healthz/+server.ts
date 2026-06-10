import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { adminDomain } from "@nojv/domain";

const CACHE_TTL_MS = 5000;
let cached: { at: number; ok: boolean } | null = null;
let inflight: Promise<boolean> | null = null;

async function probe(): Promise<boolean> {
  const checks = await adminDomain.checkSystemHealth();
  return checks.postgres === "ok" && checks.redis === "ok";
}

export const GET: RequestHandler = async () => {
  const now = Date.now();
  if (!cached || now - cached.at > CACHE_TTL_MS) {
    inflight ??= probe().finally(() => {
      inflight = null;
    });
    const ok = await inflight;
    cached = { at: Date.now(), ok };
  }
  return json({ ok: cached.ok }, { status: cached.ok ? 200 : 503 });
};
