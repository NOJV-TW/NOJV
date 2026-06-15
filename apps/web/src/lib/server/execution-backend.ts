import { getWebEnv } from "./env";

export function isAdvancedModeSupported(): boolean {
  return getWebEnv().EXECUTION_BACKEND !== "kubernetes";
}
