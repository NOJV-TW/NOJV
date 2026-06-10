import { env } from "$env/dynamic/private";

export function isAdvancedModeSupported(): boolean {
  return env.EXECUTION_BACKEND !== "kubernetes";
}
