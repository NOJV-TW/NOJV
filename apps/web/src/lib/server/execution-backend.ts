import { getWebEnv } from "./env";

export function isAdvancedModeSupported(): boolean {
  const env = getWebEnv();
  return env.EXECUTION_BACKEND === "docker" || env.ADVANCED_IMAGE_REGISTRY !== undefined;
}
