import { describe, expect, it } from "vitest";

import type * as k8s from "@kubernetes/client-node";

import {
  buildNetpolProbePodManifest,
  decideNetworkPolicyGate,
  netpolProbePodName,
  PROBE_BLOCKED_MARKER,
  PROBE_REACHED_MARKER,
  verifyNetworkPolicyEnforced,
  type NetworkPolicyProbeDeps,
} from "../../../apps/worker/src/services/k8s-netpol-probe";

const NS = "nojv-sandbox";

describe("decideNetworkPolicyGate — pure decision logic", () => {
  it("BLOCKED → enforced → ok", () => {
    expect(decideNetworkPolicyGate({ outcome: "blocked", allowUnenforced: false })).toEqual({
      enforced: true,
      action: "ok",
    });
    expect(decideNetworkPolicyGate({ outcome: "blocked", allowUnenforced: true })).toEqual({
      enforced: true,
      action: "ok",
    });
  });

  it("REACHED → not enforced → refuse unless opt-out", () => {
    expect(decideNetworkPolicyGate({ outcome: "reached", allowUnenforced: false })).toEqual({
      enforced: false,
      action: "refuse",
    });
  });

  it("REACHED with opt-out → warn-proceed", () => {
    expect(decideNetworkPolicyGate({ outcome: "reached", allowUnenforced: true })).toEqual({
      enforced: false,
      action: "warn-proceed",
    });
  });
});

describe("buildNetpolProbePodManifest", () => {
  const pod = buildNetpolProbePodManifest({
    namespace: NS,
    image: "busybox:latest",
    podName: netpolProbePodName(),
  });

  it("carries NO nojv.egress label so deny-all-sandbox (!nojv.egress) covers it", () => {
    expect(pod.metadata!.labels!["nojv.egress"]).toBeUndefined();
    expect(pod.metadata!.labels!.app).toBe("nojv-sandbox");
  });

  it("attempts an external connection and prints REACHED/BLOCKED", () => {
    const command = pod.spec!.containers[0]!.command!;
    const script = command[command.length - 1]!;
    expect(command[0]).toBe("sh");
    expect(script).toContain("wget");
    expect(script).toContain("https://1.1.1.1");
    expect(script).toContain(PROBE_REACHED_MARKER);
    expect(script).toContain(PROBE_BLOCKED_MARKER);
  });

  it("is hardened: non-root sandbox uid, cap-drop ALL, read-only rootfs, seccomp", () => {
    expect(pod.spec!.securityContext).toMatchObject({
      runAsUser: 10001,
      runAsGroup: 10001,
      runAsNonRoot: true,
      seccompProfile: { type: "RuntimeDefault" },
    });
    expect(pod.spec!.automountServiceAccountToken).toBe(false);
    expect(pod.spec!.containers[0]!.securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
      readOnlyRootFilesystem: true,
      runAsNonRoot: true,
    });
  });

  it("has a short activeDeadlineSeconds and restartPolicy Never", () => {
    expect(pod.spec!.restartPolicy).toBe("Never");
    expect(pod.spec!.activeDeadlineSeconds).toBeGreaterThan(0);
    expect(pod.spec!.activeDeadlineSeconds).toBeLessThanOrEqual(30);
  });

  it("schedules onto the sandbox node pool", () => {
    expect(pod.spec!.nodeSelector).toEqual({ "nojv-role": "sandbox" });
    expect(pod.spec!.tolerations).toEqual([
      { key: "nojv-role", operator: "Equal", value: "sandbox", effect: "NoSchedule" },
    ]);
  });

  it("requests at least the sandbox LimitRange minimum (cpu 100m, memory 64Mi)", () => {
    const requests = pod.spec!.containers[0]!.resources!.requests!;
    expect(requests.cpu).toBe("100m");
    expect(requests.memory).toBe("64Mi");
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
    readPodLog: async () => log,
    readPodPhase: async () => "Succeeded",
    deletePod: async (name: string) => {
      deleted.push(name);
    },
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
  it("REACHED log without opt-out → refuse and cleans up the probe pod", async () => {
    const f = fakeDeps(`${PROBE_REACHED_MARKER}\n`);
    const decision = await verifyNetworkPolicyEnforced({
      namespace: NS,
      allowUnenforced: false,
      deps: f.deps,
    });
    expect(decision).toEqual({ enforced: false, action: "refuse" });
    expect(f.deleted).toContain(netpolProbePodName());
  });

  it("REACHED log with opt-out → warn-proceed", async () => {
    const f = fakeDeps(`${PROBE_REACHED_MARKER}\n`);
    const decision = await verifyNetworkPolicyEnforced({
      namespace: NS,
      allowUnenforced: true,
      deps: f.deps,
    });
    expect(decision).toEqual({ enforced: false, action: "warn-proceed" });
  });

  it("BLOCKED log → ok", async () => {
    const f = fakeDeps(`${PROBE_BLOCKED_MARKER}\n`);
    const decision = await verifyNetworkPolicyEnforced({
      namespace: NS,
      allowUnenforced: false,
      deps: f.deps,
    });
    expect(decision).toEqual({ enforced: true, action: "ok" });
  });

  it("no recognizable marker → treated as blocked (fail toward enforced=ok)", async () => {
    const f = fakeDeps("garbage output\n");
    const decision = await verifyNetworkPolicyEnforced({
      namespace: NS,
      allowUnenforced: false,
      deps: f.deps,
    });
    expect(decision).toEqual({ enforced: true, action: "ok" });
  });

  it("always deletes the probe pod (before create and in finally)", async () => {
    const f = fakeDeps(`${PROBE_BLOCKED_MARKER}\n`);
    await verifyNetworkPolicyEnforced({ namespace: NS, allowUnenforced: false, deps: f.deps });
    expect(f.deleted.filter((n) => n === netpolProbePodName()).length).toBeGreaterThanOrEqual(
      2,
    );
  });
});
