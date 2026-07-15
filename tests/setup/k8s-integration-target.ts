const K3D_CONTEXT = "k3d-nojv-judge";
const NAMESPACE_PREFIX = "nojv-sandbox-test-";
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const LOCAL_K3D_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0", "[::1]"]);

type TargetEnv = Record<string, string | undefined>;

export function assertK8sIntegrationOptIn(env: TargetEnv): void {
  if (env.REQUIRE_K8S !== "1") {
    throw new Error("Refusing to run K8s integration tests without REQUIRE_K8S=1");
  }
}

export function assertSafeK8sIntegrationTarget(params: {
  env: TargetEnv;
  context: string;
  server: string;
}): { runId: string; namespace: string } {
  assertK8sIntegrationOptIn(params.env);

  if (params.context !== K3D_CONTEXT) {
    throw new Error(`Refusing K8s integration context; expected ${K3D_CONTEXT}`);
  }

  let server: URL;
  try {
    server = new URL(params.server);
  } catch {
    throw new Error("Refusing K8s integration target; expected a local k3d HTTPS endpoint");
  }
  if (
    server.protocol !== "https:" ||
    server.port === "" ||
    !LOCAL_K3D_HOSTS.has(server.hostname)
  ) {
    throw new Error("Refusing K8s integration target; expected a local k3d HTTPS endpoint");
  }

  const runId = params.env.K8S_TEST_RUN_ID ?? "";
  if (!DNS_LABEL.test(runId) || `${NAMESPACE_PREFIX}${runId}`.length > 63) {
    throw new Error("K8S_TEST_RUN_ID must be a DNS-safe namespace owner");
  }

  const namespace = params.env.K8S_TEST_NAMESPACE ?? "";
  if (namespace !== `${NAMESPACE_PREFIX}${runId}`) {
    throw new Error("K8S_TEST_NAMESPACE does not belong to K8S_TEST_RUN_ID");
  }

  return { runId, namespace };
}
