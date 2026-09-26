import { adminDomain } from "@nojv/application";

type HealthProbeKind = "live" | "ready";

const CACHE_TTL_MS = 5_000;
const PROBE_PATHS: Readonly<Record<string, HealthProbeKind>> = {
  "/api/livez": "live",
  "/api/readyz": "ready",
};
const PUBLIC_SYSTEM_PATHS = new Set(["/api/release"]);

let cached: { at: number; ready: boolean } | null = null;
let inflight: Promise<boolean> | null = null;

export function healthProbeKind(pathname: string): HealthProbeKind | null {
  return PROBE_PATHS[pathname] ?? null;
}

export function isPublicSystemPath(pathname: string): boolean {
  return healthProbeKind(pathname) !== null || PUBLIC_SYSTEM_PATHS.has(pathname);
}

export async function webIsReady(): Promise<boolean> {
  const now = Date.now();
  if (!cached || now - cached.at > CACHE_TTL_MS) {
    inflight ??= adminDomain.checkWebReadiness().finally(() => {
      inflight = null;
    });
    const ready = await inflight;
    cached = { at: Date.now(), ready };
  }
  return cached.ready;
}
