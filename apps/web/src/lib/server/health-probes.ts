import { adminDomain } from "@nojv/application";

export type HealthProbeKind = "live" | "ready";

const CACHE_TTL_MS = 5_000;
const PROBE_PATHS: Readonly<Record<string, HealthProbeKind>> = {
  "/api/livez": "live",
  "/api/readyz": "ready",
};

let cached: { at: number; ready: boolean } | null = null;
let inflight: Promise<boolean> | null = null;

export function healthProbeKind(pathname: string): HealthProbeKind | null {
  return PROBE_PATHS[pathname] ?? null;
}

async function probeReadiness(): Promise<boolean> {
  return adminDomain.checkWebReadiness();
}

export async function webIsReady(): Promise<boolean> {
  const now = Date.now();
  if (!cached || now - cached.at > CACHE_TTL_MS) {
    inflight ??= probeReadiness().finally(() => {
      inflight = null;
    });
    const ready = await inflight;
    cached = { at: Date.now(), ready };
  }
  return cached.ready;
}
