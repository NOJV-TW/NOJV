import type * as k8s from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";

import {
  buildRuntimeProbePodManifest,
  runtimeProbePodName,
  RUNTIME_PROBE_IMAGE_COMMAND,
  verifySandboxRuntime,
  type RuntimeProbeDeps,
} from "../../../apps/worker/src/services/k8s-runtime-probe";

const NS = "nojv-sandbox";

function fakeDeps(overrides: Partial<RuntimeProbeDeps> = {}): {
  deps: RuntimeProbeDeps;
  created: k8s.V1Pod[];
  deleted: string[];
} {
  const created: k8s.V1Pod[] = [];
  const deleted: string[] = [];
  const deps: RuntimeProbeDeps = {
    readRuntimeClass: async () => undefined,
    createPod: async (_namespace, body) => {
      created.push(body);
    },
    readPod: async (name, namespace) => ({
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name, namespace },
      spec: { runtimeClassName: "gvisor" },
      status: { phase: "Succeeded" },
    }),
    deletePod: async (name) => {
      deleted.push(name);
    },
    ...overrides,
  };
  return { deps, created, deleted };
}

describe("buildRuntimeProbePodManifest", () => {
  it("requests gVisor and keeps the sandbox hardening", () => {
    const pod = buildRuntimeProbePodManifest({
      namespace: NS,
      image: "nojv-sandbox:test",
      podName: runtimeProbePodName(),
      runtimeClassName: "gvisor",
      imagePullSecretName: "registry-pull",
    });

    expect(pod.spec?.runtimeClassName).toBe("gvisor");
    expect(pod.spec?.automountServiceAccountToken).toBe(false);
    expect(pod.spec?.imagePullSecrets).toEqual([{ name: "registry-pull" }]);
    expect(pod.spec?.containers[0]?.command).toEqual(RUNTIME_PROBE_IMAGE_COMMAND);
    expect(pod.spec?.containers[0]?.resources?.requests).toEqual({
      cpu: "100m",
      memory: "64Mi",
    });
    expect(pod.spec?.containers[0]?.securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
      readOnlyRootFilesystem: true,
    });
  });
});

describe("verifySandboxRuntime", () => {
  it("requires the RuntimeClass, runs the smoke pod, and cleans it up", async () => {
    const f = fakeDeps();
    const result = await verifySandboxRuntime({
      namespace: NS,
      image: "nojv-sandbox:test",
      runtimeClassName: "gvisor",
      deps: f.deps,
    });

    expect(result).toEqual({ ok: true, reason: "sandbox runtime probe succeeded" });
    expect(f.created[0]?.spec?.runtimeClassName).toBe("gvisor");
    expect(f.deleted).toEqual([runtimeProbePodName(), runtimeProbePodName()]);
  });

  it("fails closed when RuntimeClass lookup fails", async () => {
    const f = fakeDeps({
      readRuntimeClass: async () => {
        throw new Error("not found");
      },
    });

    const result = await verifySandboxRuntime({
      namespace: NS,
      image: "nojv-sandbox:test",
      runtimeClassName: "gvisor",
      deps: f.deps,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("RuntimeClass gvisor is unavailable");
    expect(f.created).toHaveLength(0);
  });

  it("fails closed when the smoke pod is not admitted with the requested runtime", async () => {
    const f = fakeDeps({
      readPod: async (name, namespace) => ({
        apiVersion: "v1",
        kind: "Pod",
        metadata: { name, namespace },
        spec: { runtimeClassName: "runc" },
      }),
    });

    const result = await verifySandboxRuntime({
      namespace: NS,
      image: "nojv-sandbox:test",
      runtimeClassName: "gvisor",
      deps: f.deps,
    });

    expect(result).toEqual({
      ok: false,
      reason: "Runtime probe Pod did not retain RuntimeClass gvisor.",
    });
  });
});
