import { describe, expect, it } from "vitest";

import type * as k8s from "@kubernetes/client-node";

import {
  buildNetpolProbeEgressPolicy,
  buildNetpolProbeIngressPolicy,
  buildNetpolProbePodManifest,
  buildNetpolProbeTargetPodManifest,
  decideNetworkPolicyGate,
  netpolProbePodName,
  PROBE_ALLOWED_REACHED_MARKER,
  PROBE_DENIED_BLOCKED_MARKER,
  PROBE_DENIED_REACHED_MARKER,
  verifyNetworkPolicyEnforced,
  type NetworkPolicyProbeDeps,
} from "../../../apps/worker/src/services/k8s-netpol-probe";

const NS = "nojv-sandbox";

describe("decideNetworkPolicyGate — pure decision logic", () => {
  it("BLOCKED → enforced → ok", () => {
    expect(decideNetworkPolicyGate({ outcome: "blocked" })).toEqual({
      enforced: true,
      action: "ok",
    });
  });

  it("REACHED → not enforced → refuse", () => {
    expect(decideNetworkPolicyGate({ outcome: "reached" })).toEqual({
      enforced: false,
      action: "refuse",
    });
  });

  it("UNCONFIRMED → not enforced (same as reached) → refuse", () => {
    expect(decideNetworkPolicyGate({ outcome: "unconfirmed" })).toEqual({
      enforced: false,
      action: "refuse",
    });
  });
});

describe("NetworkPolicy probe manifests", () => {
  it("tests an allowed and a denied internal target", () => {
    const pod = buildNetpolProbePodManifest({
      namespace: NS,
      image: "busybox:latest",
      podName: netpolProbePodName(),
      allowedTargetIp: "10.0.0.10",
      deniedTargetIp: "10.0.0.11",
    });
    const command = pod.spec!.containers[0]!.command!;
    const script = command[command.length - 1]!;
    expect(command[0]).toBe("sh");
    expect(script).toContain("http://10.0.0.10:8080");
    expect(script).toContain("http://10.0.0.11:8080");
    expect(script).toContain(PROBE_ALLOWED_REACHED_MARKER);
    expect(script).toContain(PROBE_DENIED_BLOCKED_MARKER);
    expect(script).not.toContain("1.1.1.1");
    expect(pod.metadata!.labels!["nojv-netpol-probe-source"]).toBe("true");
  });

  it("allows ingress from the probe only to the target pods", () => {
    const policy = buildNetpolProbeIngressPolicy(NS);
    expect(policy.spec).toMatchObject({
      podSelector: { matchLabels: { "nojv-netpol-probe-target": "true" } },
      policyTypes: ["Ingress"],
      ingress: [
        {
          _from: [{ podSelector: { matchLabels: { "nojv-netpol-probe-source": "true" } } }],
          ports: [{ protocol: "TCP", port: 8080 }],
        },
      ],
    });
  });

  it("allows egress only to the allowed target", () => {
    const policy = buildNetpolProbeEgressPolicy(NS);
    expect(policy.spec).toMatchObject({
      podSelector: { matchLabels: { "nojv-netpol-probe-source": "true" } },
      policyTypes: ["Egress"],
      egress: [
        {
          to: [
            {
              podSelector: {
                matchLabels: {
                  "nojv-netpol-probe-target": "true",
                  "nojv-netpol-probe-target-kind": "allowed",
                },
              },
            },
          ],
          ports: [{ protocol: "TCP", port: 8080 }],
        },
      ],
    });
  });

  it("hardens both the probe and target pods", () => {
    const target = buildNetpolProbeTargetPodManifest({
      namespace: NS,
      image: "busybox:latest",
      podName: "target",
      target: "denied",
      runtimeClassName: "gvisor",
    });
    expect(target.metadata!.labels!["nojv-netpol-probe-target-kind"]).toBe("denied");
    expect(target.spec).toMatchObject({
      runtimeClassName: "gvisor",
      automountServiceAccountToken: false,
      securityContext: {
        runAsUser: 10001,
        runAsGroup: 10001,
        runAsNonRoot: true,
        seccompProfile: { type: "RuntimeDefault" },
      },
      containers: [
        {
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ["ALL"] },
            readOnlyRootFilesystem: true,
            runAsNonRoot: true,
          },
        },
      ],
    });
    const readiness = target.spec!.containers[0]!.readinessProbe!;
    expect(readiness.tcpSocket).toBeUndefined();
    expect(readiness.exec?.command?.join(" ")).toContain("127.0.0.1:8080");
  });
});

function fakeDeps(
  log: string,
  overrides: Partial<NetworkPolicyProbeDeps> = {},
): { deps: NetworkPolicyProbeDeps; deleted: string[]; created: number } {
  const deleted: string[] = [];
  let created = 0;
  const deps: NetworkPolicyProbeDeps = {
    createPod: async (_ns: string, _body: k8s.V1Pod) => {
      created++;
    },
    readPod: async (name: string) => ({
      status: {
        phase: "Running",
        podIP: name.includes("allowed") ? "10.0.0.10" : "10.0.0.11",
        containerStatuses: [{ name: "target", ready: true, restartCount: 0, image: "busybox" }],
      },
    }),
    readPodLog: async () => log,
    readPodPhase: async () => "Succeeded",
    deletePod: async (name: string) => {
      deleted.push(name);
    },
    createNetworkPolicy: async () => undefined,
    deleteNetworkPolicy: async () => undefined,
    sleep: async () => undefined,
    ...overrides,
  };
  return {
    deps,
    deleted,
    get created() {
      return created;
    },
  };
}

describe("verifyNetworkPolicyEnforced — live probe wiring", () => {
  it("DENIED_REACHED → refuse and cleans up all probe resources", async () => {
    const f = fakeDeps(`${PROBE_DENIED_REACHED_MARKER}\n`);
    const decision = await verifyNetworkPolicyEnforced({
      namespace: NS,
      deps: f.deps,
    });
    expect(decision).toEqual({ enforced: false, action: "refuse" });
    expect(f.deleted).toContain(netpolProbePodName());
    expect(f.created).toBe(3);
  });

  it("ALLOWED_REACHED plus DENIED_BLOCKED → ok", async () => {
    const f = fakeDeps(`${PROBE_ALLOWED_REACHED_MARKER}\n${PROBE_DENIED_BLOCKED_MARKER}\n`);
    const decision = await verifyNetworkPolicyEnforced({
      namespace: NS,
      deps: f.deps,
    });
    expect(decision).toEqual({ enforced: true, action: "ok" });
  });

  it("terminal Pod with NO recognizable marker → unconfirmed → REFUSE (fail closed)", async () => {
    const f = fakeDeps("garbage output\n");
    const decision = await verifyNetworkPolicyEnforced({
      namespace: NS,
      deps: f.deps,
    });
    expect(decision).toEqual({ enforced: false, action: "refuse" });
  });

  it("clean ALLOWED_REACHED plus DENIED_BLOCKED is the ONLY path to ok", async () => {
    const ok = await verifyNetworkPolicyEnforced({
      namespace: NS,
      deps: fakeDeps(`${PROBE_ALLOWED_REACHED_MARKER}\n${PROBE_DENIED_BLOCKED_MARKER}\n`).deps,
    });
    expect(ok).toEqual({ enforced: true, action: "ok" });

    for (const log of [`${PROBE_DENIED_REACHED_MARKER}\n`, "garbage\n", ""]) {
      const decision = await verifyNetworkPolicyEnforced({
        namespace: NS,
        deps: fakeDeps(log).deps,
      });
      expect(decision.action).toBe("refuse");
    }
  });

  it("probe targets perpetually Pending → timeout → unconfirmed → refuse", async () => {
    let clock = 0;
    const pendingOverrides: Partial<NetworkPolicyProbeDeps> = {
      readPod: async () => ({ status: { phase: "Pending" } }),
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
    };

    const refused = await verifyNetworkPolicyEnforced({
      namespace: NS,
      deps: fakeDeps(
        `${PROBE_ALLOWED_REACHED_MARKER}\n${PROBE_DENIED_BLOCKED_MARKER}\n`,
        pendingOverrides,
      ).deps,
    });
    expect(refused).toEqual({ enforced: false, action: "refuse" });
  });

  it("createPod rejects → error propagates so worker-app fails closed", async () => {
    const f = fakeDeps(`${PROBE_ALLOWED_REACHED_MARKER}\n${PROBE_DENIED_BLOCKED_MARKER}\n`, {
      createPod: async () => {
        throw new Error("ResourceQuota exceeded");
      },
    });
    await expect(verifyNetworkPolicyEnforced({ namespace: NS, deps: f.deps })).rejects.toThrow(
      /ResourceQuota/,
    );
    expect(f.deleted).toContain(netpolProbePodName());
  });

  it("readPodLog throws → unconfirmed → refuse", async () => {
    const f = fakeDeps(`${PROBE_ALLOWED_REACHED_MARKER}\n${PROBE_DENIED_BLOCKED_MARKER}\n`, {
      readPodLog: async () => {
        throw new Error("logs unavailable");
      },
    });
    const decision = await verifyNetworkPolicyEnforced({
      namespace: NS,
      deps: f.deps,
    });
    expect(decision).toEqual({ enforced: false, action: "refuse" });
  });

  it("always deletes the probe resources before create and in finally", async () => {
    const f = fakeDeps(`${PROBE_ALLOWED_REACHED_MARKER}\n${PROBE_DENIED_BLOCKED_MARKER}\n`);
    await verifyNetworkPolicyEnforced({ namespace: NS, deps: f.deps });
    expect(f.deleted.filter((n) => n === netpolProbePodName()).length).toBeGreaterThanOrEqual(
      2,
    );
  });
});
