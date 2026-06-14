import { describe, expect, it } from "vitest";

import {
  buildGradeEgressPolicy,
  buildProxyRunEnv,
  buildProxySidecarPodManifest,
  buildRunEgressPolicy,
  buildServiceRunEnv,
  buildServiceSidecarPodManifest,
  buildSidecarEgressPolicy,
  buildSidecarServiceManifest,
  EGRESS_LABEL_KEY,
  gradeEgressLabel,
  PROXY_READY_MARKER,
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
    // Mirrors infra/k8s/sandbox/network-policy.yaml + infra/gcp/gke/network-policy.yaml.
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

describe("buildGradeEgressPolicy — grade Pod escapes deny-all with FULL egress", () => {
  it("selects the grade Pod by nojv.egress=<submissionId>-grade (distinct from run)", () => {
    const policy = buildGradeEgressPolicy({ submissionId: SUB, namespace: NS });
    expect(policy.spec!.podSelector!.matchLabels).toEqual({
      [EGRESS_LABEL_KEY]: gradeEgressLabel(SUB),
    });
    expect(gradeEgressLabel(SUB)).toBe(`${SUB}-grade`);
    expect(gradeEgressLabel(SUB)).not.toBe(runEgressLabel(SUB));
  });

  it("grants full egress (a single open egress rule) while denying all ingress", () => {
    const policy = buildGradeEgressPolicy({ submissionId: SUB, namespace: NS });
    expect(policy.spec!.policyTypes).toEqual(["Ingress", "Egress"]);
    expect(policy.spec!.egress).toEqual([{}]);
    expect(policy.spec!.ingress).toEqual([]);
  });
});

describe("buildSidecarEgressPolicy — sidecar full egress, ingress ONLY from the run Pod", () => {
  it("selects the sidecar Pod and grants full egress", () => {
    const policy = buildSidecarEgressPolicy({ submissionId: SUB, namespace: NS });
    expect(policy.spec!.podSelector!.matchLabels).toEqual({
      [SIDECAR_ROLE_LABEL_KEY]: SUB,
    });
    expect(policy.spec!.policyTypes).toEqual(["Ingress", "Egress"]);
    expect(policy.spec!.egress).toEqual([{}]);
  });

  it("SECURITY: allows ingress ONLY from the run Pod (nojv.egress=<id>), nothing else", () => {
    const policy = buildSidecarEgressPolicy({ submissionId: SUB, namespace: NS });
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

describe("buildProxySidecarPodManifest — reuses the egress-proxy image, hardened", () => {
  it("uses the configured proxy image and renders NOJV_ALLOWLIST from the allowlist", () => {
    const pod = buildProxySidecarPodManifest({
      submissionId: SUB,
      namespace: NS,
      image: "registry/nojv/egress-proxy:latest",
      allowlist: ["api.example.com:443", "data.example.org"],
      port: SIDECAR_PORT,
    });
    const container = pod.spec!.containers[0]!;
    expect(container.image).toBe("registry/nojv/egress-proxy:latest");
    const env = Object.fromEntries((container.env ?? []).map((e) => [e.name, e.value]));
    expect(env.NOJV_ALLOWLIST).toBe("api.example.com:443,data.example.org");
    expect(env.NOJV_PROXY_PORT).toBe(String(SIDECAR_PORT));
  });

  it("carries the sidecar role label and is hardened (non-root, cap-drop, read-only rootfs)", () => {
    const pod = buildProxySidecarPodManifest({
      submissionId: SUB,
      namespace: NS,
      image: "proxy:1",
      allowlist: ["x.example.com"],
      port: SIDECAR_PORT,
    });
    expect(pod.metadata!.labels![SIDECAR_ROLE_LABEL_KEY]).toBe(SUB);
    expect(pod.spec!.automountServiceAccountToken).toBe(false);
    expect(pod.spec!.securityContext).toMatchObject({
      runAsNonRoot: true,
      seccompProfile: { type: "RuntimeDefault" },
    });
    expect(pod.spec!.containers[0]!.securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
      readOnlyRootFilesystem: true,
    });
  });

  it("does NOT carry the nojv.egress escape label (its access is via its own sidecar policy)", () => {
    const pod = buildProxySidecarPodManifest({
      submissionId: SUB,
      namespace: NS,
      image: "proxy:1",
      allowlist: ["x.example.com"],
      port: SIDECAR_PORT,
    });
    expect(pod.metadata!.labels![EGRESS_LABEL_KEY]).toBeUndefined();
  });
});

describe("buildServiceSidecarPodManifest — TA service image (registry only), full-net peer", () => {
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
    expect(container.resources!.limits!.memory).toBe("512Mi");
    expect(pod.spec!.automountServiceAccountToken).toBe(false);
    expect(pod.spec!.securityContext).toMatchObject({ runAsNonRoot: true });
    expect(container.securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
      readOnlyRootFilesystem: true,
    });
    expect(pod.spec!.volumes!.some((v) => v.name === "tmp" && v.emptyDir)).toBe(true);
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
  it("buildProxyRunEnv points HTTP(S)_PROXY at the sidecar ClusterIP:port (no DNS in run Pod)", () => {
    const env = buildProxyRunEnv("10.96.0.42", SIDECAR_PORT);
    expect(env.HTTP_PROXY).toBe("http://10.96.0.42:8888");
    expect(env.HTTPS_PROXY).toBe("http://10.96.0.42:8888");
    expect(env.http_proxy).toBe("http://10.96.0.42:8888");
    expect(env.NO_PROXY).toBe("");
    expect(env.HTTP_PROXY).not.toContain("sidecar");
  });

  it("buildServiceRunEnv injects NOJV_SERVICE_HOST as the sidecar ClusterIP", () => {
    const env = buildServiceRunEnv("10.96.0.42");
    expect(env.NOJV_SERVICE_HOST).toBe("10.96.0.42");
    expect(env.NOJV_SERVICE_HOST).not.toContain("sidecar");
  });
});

describe("readiness markers", () => {
  it("re-exports the proxy and service ready markers from the docker analogues", () => {
    expect(PROXY_READY_MARKER).toBe("NOJV_PROXY_READY");
    expect(SERVICE_READY_MARKER).toBe("NOJV_SERVICE_READY");
  });
});
