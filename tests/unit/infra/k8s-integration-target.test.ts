import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertSafeK8sIntegrationTarget } from "../../setup/k8s-integration-target";

const RUN_ID = "gh-29274453881-1";
const NAMESPACE = `nojv-sandbox-test-${RUN_ID}`;
const VALID_ENV = {
  REQUIRE_K8S: "1",
  K8S_TEST_RUN_ID: RUN_ID,
  K8S_TEST_NAMESPACE: NAMESPACE,
};

function validate(
  overrides: Partial<{
    env: Record<string, string | undefined>;
    context: string;
    server: string;
  }> = {},
) {
  return assertSafeK8sIntegrationTarget({
    env: overrides.env ?? VALID_ENV,
    context: overrides.context ?? "k3d-nojv-judge",
    server: overrides.server ?? "https://127.0.0.1:41927",
  });
}

describe("K8s integration target safety", () => {
  it.each(["https://127.0.0.1:41927", "https://localhost:41927", "https://0.0.0.0:41927"])(
    "accepts an explicitly owned namespace on local k3d server %s",
    (server) => {
      expect(validate({ server })).toEqual({ runId: RUN_ID, namespace: NAMESPACE });
    },
  );

  it.each([{}, { REQUIRE_K8S: "0" }])("hard-refuses missing REQUIRE_K8S=1", (env) => {
    expect(() =>
      validate({ env: { ...VALID_ENV, ...env, REQUIRE_K8S: env.REQUIRE_K8S } }),
    ).toThrow(/REQUIRE_K8S=1/);
  });

  it.each(["orbstack", "production", "gke_nojv-prod_asia-east1_nojv"])(
    "rejects context %s",
    (context) => {
      expect(() => validate({ context })).toThrow(/k3d-nojv-judge/);
    },
  );

  it.each([
    "https://10.0.0.1:6443",
    "https://api.example.com:6443",
    "http://127.0.0.1:41927",
    "https://127.0.0.1",
  ])("rejects non-local or malformed cluster server %s", (server) => {
    expect(() => validate({ server })).toThrow(/local k3d/i);
  });

  it.each([undefined, "", "UPPER_case", "ends-"])("rejects invalid run ID %j", (runId) => {
    expect(() => validate({ env: { ...VALID_ENV, K8S_TEST_RUN_ID: runId } })).toThrow(
      /K8S_TEST_RUN_ID/,
    );
  });

  it.each([undefined, "", "nojv-sandbox", "nojv-sandbox-test-someone-else"])(
    "rejects unowned namespace %j",
    (namespace) => {
      expect(() => validate({ env: { ...VALID_ENV, K8S_TEST_NAMESPACE: namespace } })).toThrow(
        /K8S_TEST_NAMESPACE/,
      );
    },
  );
});

describe("K8s integration wiring", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

  it("validates ownership before constructing any Kubernetes API client", () => {
    const source = readFileSync(
      join(repoRoot, "tests/integration/k8s/judge-k8s.test.ts"),
      "utf8",
    );
    const setup = source.indexOf("beforeAll(async");
    const guard = source.indexOf("assertSafeK8sIntegrationTarget({", setup);
    const client = source.indexOf("makeApiClient", setup);

    expect(guard).toBeGreaterThan(setup);
    expect(client).toBeGreaterThan(guard);
    expect(source).not.toContain("skipIfUnreachable");
    expect(source).not.toContain('const NAMESPACE = "nojv-sandbox"');
  });

  it("gives every nightly run an owned namespace and always tears it down with the cluster", () => {
    const workflow = readFileSync(
      join(repoRoot, ".github/workflows/nightly-sandbox.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      "K8S_TEST_RUN_ID: gh-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(workflow).toContain(
      "K8S_TEST_NAMESPACE: nojv-sandbox-test-gh-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(workflow).toContain('--set-string sandboxNamespace="$K8S_TEST_NAMESPACE"');
    expect(workflow).toContain("--set image.allowUnpinnedLocalBuilds=true");
    expect(workflow).toContain(
      'kubectl --context k3d-nojv-judge delete namespace "$K8S_TEST_NAMESPACE"',
    );
    expect(workflow).toContain("k3d cluster delete nojv-judge");
    expect(workflow.match(/if: always\(\)/g)).toHaveLength(2);
  });

  it("builds and pushes the canonical scaffold as a dedicated service image", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const build = packageJson.scripts["demo-advanced:build"] ?? "";
    const push = packageJson.scripts["demo-advanced:push"] ?? "";
    const canonicalService = "apps/web/src/lib/server/advanced-scaffold/files/service";
    const publisher = readFileSync(join(repoRoot, push), "utf8");

    expect(build).toContain("nojv-demo-advanced-service:local");
    expect(build).toContain(canonicalService);
    expect(build).not.toContain(":main");
    expect(push).toBe("scripts/publish-demo-images.sh");
    expect(publisher).toContain("${DEMO_IMAGE_REGISTRY%/}/${name}:${DEMO_IMAGE_TAG}");
    expect(publisher).toContain(canonicalService);
    expect(publisher).toContain("{{.Manifest.Digest}}");
    expect(publisher).not.toContain(":main");
  });

  it("imports the dedicated service image into the nightly k3d cluster", () => {
    const workflow = readFileSync(
      join(repoRoot, ".github/workflows/nightly-sandbox.yml"),
      "utf8",
    );
    expect(workflow).toContain("nojv-demo-advanced-service:local");
  });

  it("uses the dedicated service image instead of the ordinary run image", () => {
    const integration = readFileSync(
      join(repoRoot, "tests/integration/k8s/judge-k8s.test.ts"),
      "utf8",
    );
    const serviceCase = integration.slice(integration.indexOf("AC: service network mode"));
    expect(integration).toContain(
      'const DEMO_SERVICE_IMAGE = "nojv-demo-advanced-service:local"',
    );
    expect(serviceCase).toContain("service: { imageRef: DEMO_SERVICE_IMAGE");
    expect(serviceCase).not.toContain("service: { imageRef: DEMO_RUN_IMAGE");
  });

  it("makes the service-mode submission call the injected /health endpoint", () => {
    const integration = readFileSync(
      join(repoRoot, "tests/integration/k8s/judge-k8s.test.ts"),
      "utf8",
    );
    const serviceCase = integration.slice(integration.indexOf("AC: service network mode"));

    expect(serviceCase).toContain("SERVICE_HEALTH_SUM_SOLUTION");
    expect(integration).toContain('os.environ["NOJV_SERVICE_HOST"]');
    expect(integration).toContain('/health", timeout=5');
    expect(integration).toContain('raise RuntimeError("service health check failed")');
  });
});
