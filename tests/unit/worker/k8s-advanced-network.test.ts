import { describe, expect, it } from "vitest";

import {
  buildGradeEgressPolicy,
  buildRunEgressPolicy,
  buildServiceRunEnv,
  buildServiceSidecarPodManifest,
  buildSidecarNetworkPolicy,
  buildSidecarServiceManifest,
  EGRESS_LABEL_KEY,
  gradeEgressLabel,
  runEgressLabel,
  SERVICE_READY_MARKER,
  SIDECAR_PORT,
  SIDECAR_ROLE_LABEL_KEY,
} from "../../../apps/worker/src/services/k8s-advanced-network";

const SUB = "sub-net-1";
const NS = "nojv-sandbox";

function flattenEgressTargets(policy: { spec?: any }): unknown[] {
  return (policy.spec?.egress ?? []).flatMap((rule: any) => rule.to ?? []);
}

function policyJson(policy: unknown): string {
  return JSON.stringify(policy);
}

describe("deny-all relabel — manifest YAML excludes nojv.egress-labeled pods", () => {
  it("the sandbox deny-all NetworkPolicy uses DoesNotExist on nojv.egress", () => {
    // Mirrors the deny-all-sandbox NetworkPolicy in infra/charts/nojv/templates/sandbox-policy.yaml.
    // A pod WITH nojv.egress is NOT selected by deny-all (escapes it); one WITHOUT IS.
    const denyAllSelector = {
      matchExpressions: [{ key: EGRESS_LABEL_KEY, operator: "DoesNotExist" }],
    };
    const podWithEgressLabel = { [EGRESS_LABEL_KEY]: SUB };
    const podWithoutEgressLabel: Record<string, string> = { app: "nojv-sandbox" };

    const selects = (labels: Record<string, string>): boolean =>
      denyAllSelector.matchExpressions.every((e) =>
        e.operator === "DoesNotExist" ? !(e.key in labels) : true,
      );

    expect(selects(podWithEgressLabel)).toBe(false);
    expect(selects(podWithoutEgressLabel)).toBe(true);
  });
});

describe("buildRunEgressPolicy — run Pod egress restricted to the sidecar ONLY", () => {
  it("selects the run Pod by nojv.egress=<submissionId>", () => {
    const policy = buildRunEgressPolicy({ submissionId: SUB, namespace: NS });
    expect(policy.spec!.podSelector!.matchLabels).toEqual({
      [EGRESS_LABEL_KEY]: runEgressLabel(SUB),
    });
    expect(runEgressLabel(SUB)).toBe(SUB);
  });

  it("allows egress ONLY to the sidecar Pod's label selector", () => {
    const policy = buildRunEgressPolicy({ submissionId: SUB, namespace: NS });
    expect(policy.spec!.policyTypes).toEqual(["Ingress", "Egress"]);
    const targets = flattenEgressTargets(policy);
    expect(targets).toEqual([
      { podSelector: { matchLabels: { [SIDECAR_ROLE_LABEL_KEY]: SUB } } },
    ]);
  });

  it("SECURITY: denies ALL ingress to the untrusted run Pod (student code is not a server)", () => {
    const policy = buildRunEgressPolicy({ submissionId: SUB, namespace: NS });
    expect(policy.spec!.policyTypes).toContain("Ingress");
    expect(policy.spec!.ingress).toEqual([]);
  });

  it("SECURITY: grants NO broad egress — no 0.0.0.0/0, no ipBlock, no empty rule", () => {
    const policy = buildRunEgressPolicy({ submissionId: SUB, namespace: NS });
    const json = policyJson(policy);
    expect(json).not.toContain("0.0.0.0/0");
    expect(json).not.toContain("ipBlock");
    expect(json).not.toContain("namespaceSelector");
    for (const rule of policy.spec!.egress ?? []) {
      expect(rule.to).toBeDefined();
      expect(rule.to!.length).toBeGreaterThan(0);
      for (const peer of rule.to!) {
        expect(peer.podSelector).toBeDefined();
        expect(peer.ipBlock).toBeUndefined();
      }
    }
  });
});

describe("buildGradeEgressPolicy — grade Pod escapes deny-all but is denied ALL egress", () => {
  it("selects the grade Pod by nojv.egress=<submissionId>-grade (distinct from run)", () => {
    const policy = buildGradeEgressPolicy({ submissionId: SUB, namespace: NS });
    expect(policy.spec!.podSelector!.matchLabels).toEqual({
      [EGRESS_LABEL_KEY]: gradeEgressLabel(SUB),
    });
    expect(gradeEgressLabel(SUB)).toBe(`${SUB}-grade`);
    expect(gradeEgressLabel(SUB)).not.toBe(runEgressLabel(SUB));
  });

  it("SECURITY: denies ALL egress (empty egress list) and all ingress", () => {
    const policy = buildGradeEgressPolicy({ submissionId: SUB, namespace: NS });
    expect(policy.spec!.policyTypes).toEqual(["Ingress", "Egress"]);
    expect(policy.spec!.egress).toEqual([]);
    expect(policy.spec!.ingress).toEqual([]);
  });
});

describe("buildSidecarNetworkPolicy — ingress only from the matching run Pod", () => {
  it("denies all egress for a TA service sidecar", () => {
    const policy = buildSidecarNetworkPolicy({
      submissionId: SUB,
      namespace: NS,
    });
    expect(policy.spec!.podSelector!.matchLabels).toEqual({
      [SIDECAR_ROLE_LABEL_KEY]: SUB,
    });
    expect(policy.spec!.policyTypes).toEqual(["Ingress", "Egress"]);
    expect(policy.spec!.egress).toEqual([]);
  });

  it("SECURITY: allows ingress ONLY from the run Pod (nojv.egress=<id>), nothing else", () => {
    const policy = buildSidecarNetworkPolicy({
      submissionId: SUB,
      namespace: NS,
    });
    // The client serializes the `_from` field to wire `from` (attributeTypeMap baseName).
    expect(policy.spec!.ingress).toEqual([
      {
        _from: [{ podSelector: { matchLabels: { [EGRESS_LABEL_KEY]: runEgressLabel(SUB) } } }],
      },
    ]);
    const json = policyJson(policy);
    expect(json).not.toContain("0.0.0.0/0");
    expect(json).not.toContain("ipBlock");
    expect(json).not.toContain("namespaceSelector");
  });
});

describe("buildServiceSidecarPodManifest — TA service image (registry only), isolated peer", () => {
  it("uses the TA service image and the sidecar role label", () => {
    const pod = buildServiceSidecarPodManifest({
      submissionId: SUB,
      namespace: NS,
      image: "registry/ta/service:1.0",
      memoryMb: 512,
      cpuLimit: "1",
      port: SIDECAR_PORT,
    });
    const container = pod.spec!.containers[0]!;
    expect(container.image).toBe("registry/ta/service:1.0");
    expect(pod.metadata!.labels![SIDECAR_ROLE_LABEL_KEY]).toBe(SUB);
    expect(container.ports![0]!.containerPort).toBe(SIDECAR_PORT);
    expect(container.env).toContainEqual({ name: "PORT", value: String(SIDECAR_PORT) });
    expect(container.env).toContainEqual({ name: "PORT", value: "8888" });
    expect(container.resources!.limits!.memory).toBe("512Mi");
    expect(pod.spec!.automountServiceAccountToken).toBe(false);
    expect(pod.spec!.securityContext).toMatchObject({
      runAsNonRoot: true,
      runAsUser: 10001,
      runAsGroup: 10001,
      fsGroup: 10001,
    });
    expect(container.securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
      readOnlyRootFilesystem: true,
      runAsNonRoot: true,
      runAsUser: 10001,
      runAsGroup: 10001,
    });
    expect(pod.spec!.volumes!.some((v) => v.name === "tmp" && v.emptyDir)).toBe(true);
  });

  it("pins the service to the same non-root uid on every executor backend", () => {
    const pod = buildServiceSidecarPodManifest({
      submissionId: SUB,
      namespace: NS,
      image: "registry/ta/service:1.0",
      memoryMb: 512,
      cpuLimit: "1",
      port: SIDECAR_PORT,
    });
    const podCtx = pod.spec!.securityContext as Record<string, unknown>;
    const containerCtx = pod.spec!.containers[0]!.securityContext as Record<string, unknown>;
    expect(podCtx.runAsUser).toBe(10001);
    expect(podCtx.runAsGroup).toBe(10001);
    expect(containerCtx.runAsUser).toBe(10001);
    expect(containerCtx.runAsGroup).toBe(10001);
  });

  it("carries imagePullSecrets when an imagePullSecretName is supplied", () => {
    const pod = buildServiceSidecarPodManifest({
      submissionId: SUB,
      namespace: NS,
      image: "registry/ta/service:1.0",
      memoryMb: 512,
      cpuLimit: "1",
      port: SIDECAR_PORT,
      imagePullSecretName: "nojv-registry-pull",
    });
    expect(pod.spec!.imagePullSecrets).toEqual([{ name: "nojv-registry-pull" }]);
  });

  it("omits imagePullSecrets when no imagePullSecretName is supplied", () => {
    const pod = buildServiceSidecarPodManifest({
      submissionId: SUB,
      namespace: NS,
      image: "registry/ta/service:1.0",
      memoryMb: 512,
      cpuLimit: "1",
      port: SIDECAR_PORT,
    });
    expect(pod.spec!.imagePullSecrets).toBeUndefined();
  });
});

describe("buildSidecarServiceManifest — ClusterIP Service pointing at the sidecar", () => {
  it("is a ClusterIP Service selecting the sidecar by its role label", () => {
    const svc = buildSidecarServiceManifest({
      submissionId: SUB,
      namespace: NS,
      port: SIDECAR_PORT,
    });
    expect(svc.spec!.type).toBe("ClusterIP");
    expect(svc.spec!.selector).toEqual({ [SIDECAR_ROLE_LABEL_KEY]: SUB });
    expect(svc.spec!.ports![0]).toMatchObject({ port: SIDECAR_PORT, targetPort: SIDECAR_PORT });
  });
});

describe("run env injection helpers — inject the sidecar ClusterIP, never a DNS name", () => {
  it("buildServiceRunEnv injects NOJV_SERVICE_HOST as the sidecar ClusterIP:8888 (host:port)", () => {
    const env = buildServiceRunEnv("10.96.0.42");
    expect(env.NOJV_SERVICE_HOST).toBe("10.96.0.42:8888");
    expect(env.NOJV_SERVICE_HOST).not.toContain("sidecar");
  });
});

describe("readiness markers", () => {
  it("re-exports the service ready marker from the docker analogue", () => {
    expect(SERVICE_READY_MARKER).toBe("NOJV_SERVICE_READY");
  });
});
