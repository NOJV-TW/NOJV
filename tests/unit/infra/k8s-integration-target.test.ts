import { describe, expect, it } from "vitest";

import {
  assertSafeK8sIntegrationContext,
  isK8sIntegrationEnabled,
} from "../../setup/k8s-integration-target";

describe("K8s integration target safety", () => {
  it("requires an explicit REQUIRE_K8S=1 opt-in", () => {
    expect(isK8sIntegrationEnabled({})).toBe(false);
    expect(isK8sIntegrationEnabled({ REQUIRE_K8S: "0" })).toBe(false);
    expect(isK8sIntegrationEnabled({ REQUIRE_K8S: "1" })).toBe(true);
  });

  it.each(["orbstack", "k3d-nojv-judge"])("allows the known local context %s", (context) => {
    expect(() => assertSafeK8sIntegrationContext(context)).not.toThrow();
  });

  it.each(["", "gke_nojv-prod_asia-east1_nojv", "production"])(
    "rejects the non-test context %j",
    (context) => {
      expect(() => assertSafeK8sIntegrationContext(context)).toThrow(/refusing/i);
    },
  );
});
