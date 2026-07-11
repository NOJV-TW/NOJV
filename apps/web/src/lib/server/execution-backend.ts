import { getWebEnv } from "./env";

export function isAdvancedZipUploadEnabled(): boolean {
  return getWebEnv().NODE_ENV === "development";
}
