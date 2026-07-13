const SAFE_K8S_INTEGRATION_CONTEXTS = new Set(["orbstack", "k3d-nojv-judge"]);

export function isK8sIntegrationEnabled(env: Record<string, string | undefined>): boolean {
  return env.REQUIRE_K8S === "1";
}

export function assertSafeK8sIntegrationContext(context: string): void {
  if (!SAFE_K8S_INTEGRATION_CONTEXTS.has(context)) {
    throw new Error(`Refusing to run K8s integration tests against context "${context}"`);
  }
}
