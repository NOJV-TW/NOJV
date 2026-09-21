import type { V1Container, V1PodSpec, V1ResourceQuota } from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";

import { findSandboxQuotaViolation } from "../../../apps/worker/src/services/k8s-executor";

const container = (name: string, cpu: string, memory = "128Mi"): V1Container => ({
  name,
  resources: { requests: { cpu, memory }, limits: { cpu, memory } },
});
const pod = (cpu = "1", memory = "128Mi"): V1PodSpec => ({
  containers: [container("run", cpu, memory)],
});
const quota = (hard: Record<string, string>, used = hard): V1ResourceQuota => ({
  metadata: { name: "sandbox" },
  spec: { hard },
  status: { hard, used },
});

describe("sandbox hard quota proof", () => {
  it.each([
    ["requests.cpu", pod("2"), "1500m"],
    ["requests.memory", pod("1", "1.5Gi"), "1024Mi"],
    ["limits.cpu", pod("2"), "1"],
    ["limits.memory", pod("1", "256Mi"), "128Mi"],
    ["cpu", pod("2"), "1"],
    ["memory", pod("1", "256Mi"), "128Mi"],
  ])("proves %s cannot fit even with zero usage", (resource, spec, hard) => {
    expect(findSandboxQuotaViolation([spec], [quota({ [resource]: hard }, {})])).toContain(
      resource,
    );
  });

  it("ignores occupied capacity when the requested resources can fit the hard limit", () => {
    expect(
      findSandboxQuotaViolation(
        [pod("1", "512Mi")],
        [quota({ "requests.cpu": "1", "requests.memory": "512Mi" })],
      ),
    ).toBeNull();
  });

  it("takes max of sequential initialization and regular containers", () => {
    const spec = {
      ...pod("1"),
      initContainers: [container("prepare", "2"), container("copy", "2")],
    };
    expect(findSandboxQuotaViolation([spec], [quota({ "requests.cpu": "2" })])).toBeNull();
  });

  it("counts restartable init containers throughout subsequent initialization and execution", () => {
    const spec: V1PodSpec = {
      ...pod("1"),
      initContainers: [
        { ...container("first-sidecar", "500m"), restartPolicy: "Always" },
        container("prepare", "2"),
        { ...container("second-sidecar", "500m"), restartPolicy: "Always" },
      ],
    };
    expect(findSandboxQuotaViolation([spec], [quota({ "requests.cpu": "2.4" })])).toContain(
      "requires 2.5",
    );
    expect(findSandboxQuotaViolation([spec], [quota({ "requests.cpu": "2.5" })])).toBeNull();
    spec.containers.push(container("runner-helper", "1"));
    expect(findSandboxQuotaViolation([spec], [quota({ "requests.cpu": "2.5" })])).toContain(
      "requires 3",
    );
  });

  it("does not infer omitted requests from limits before admission defaults", () => {
    expect(
      findSandboxQuotaViolation(
        [{ containers: [{ name: "run", resources: { limits: { cpu: "4", memory: "4Gi" } } }] }],
        [quota({ "requests.cpu": "1", "requests.memory": "1Gi" })],
      ),
    ).toBeNull();
    expect(
      findSandboxQuotaViolation(
        [{ containers: [{ name: "run" }] }],
        [quota({ "requests.cpu": "1", "limits.cpu": "1" })],
      ),
    ).toBeNull();
  });

  it("requires fully declared limits to claim a limit aggregate violation", () => {
    const spec = { containers: [container("run", "2"), { name: "helper" }] };
    expect(findSandboxQuotaViolation([spec], [quota({ "limits.cpu": "1" })])).toBeNull();
  });

  it("includes Pod-level resources and explicit overhead", () => {
    const spec: V1PodSpec = {
      ...pod(),
      resources: { requests: { cpu: "2" } },
      overhead: { cpu: "100m" },
    };
    expect(findSandboxQuotaViolation([spec], [quota({ "requests.cpu": "2" })])).toContain(
      "requires 2.1",
    );
  });

  it("does not invent overhead for an unknown RuntimeClass", () => {
    expect(
      findSandboxQuotaViolation(
        [{ ...pod(), runtimeClassName: "gvisor" }],
        [quota({ "requests.cpu": "1" })],
      ),
    ).toBeNull();
  });

  it("ignores scoped quotas whose applicability has not been proven", () => {
    expect(
      findSandboxQuotaViolation(
        [pod("2")],
        [
          {
            ...quota({ "requests.cpu": "1" }),
            spec: { hard: { "requests.cpu": "1" }, scopes: ["BestEffort"] },
          },
        ],
      ),
    ).toBeNull();
  });

  it("counts concurrently required Pods without including unrelated live submissions", () => {
    expect(findSandboxQuotaViolation([pod(), pod()], [quota({ pods: "1" })])).toContain(
      "pods requires 2",
    );
    expect(findSandboxQuotaViolation([pod()], [quota({ "count/pods": "0" })])).toContain(
      "count/pods",
    );
    expect(findSandboxQuotaViolation([pod()], [quota({ pods: "1" })])).toBeNull();
  });

  it("does not misclassify fractional CPU floating-point sums", () => {
    const spec = {
      containers: Array.from({ length: 20 }, (_, i) => container(`run-${i}`, "100m")),
    };
    expect(findSandboxQuotaViolation([spec], [quota({ "requests.cpu": "2" })])).toBeNull();
  });
});
