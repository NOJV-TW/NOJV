import { env } from "$env/dynamic/private";

/**
 * Advanced (special_env) judging runs only on the Docker backend — the K8s
 * executor rejects advanced-mode requests (see
 * apps/worker/src/services/k8s-executor.ts). Gate authoring on the configured
 * backend so teachers can't create problems that would silently fail to judge.
 *
 * Defaults to supported when unset, so existing Docker deployments are
 * unaffected; only an explicit EXECUTION_BACKEND=kubernetes blocks creation.
 */
export function isAdvancedModeSupported(): boolean {
  return (env.EXECUTION_BACKEND ?? "docker") !== "kubernetes";
}
