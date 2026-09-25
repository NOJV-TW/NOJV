import { ADVANCED_SERVICE_PORT } from "@nojv/sandbox-docker";

export const SERVICE_HOST_ENV = "NOJV_SERVICE_HOST";

export function serviceHostEnv(host: string): Record<string, string> {
  return { [SERVICE_HOST_ENV]: `${host}:${String(ADVANCED_SERVICE_PORT)}` };
}
