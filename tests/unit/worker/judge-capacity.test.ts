import { describe, expect, it } from "vitest";
import type { V1Node, V1Pod } from "@kubernetes/client-node";

import {
  admitAvailable,
  buildCapacitySnapshot,
  cancelQueuedRun,
  compactAdmissionState,
  confirmPermitCleanup,
  createAdmissionState,
  effectivePodRequests,
  enqueueAdmission,
  finishAdmissionRun,
  parseResourceQuantity,
  registerAdmissionRun,
  updateCapacitySnapshot,
  ADMISSION_TOMBSTONE_RETENTION_MS,
  type JudgeAdmissionRequest,
  type JudgeAdmissionState,
} from "../../../apps/worker/src/services/judge-capacity";

const Mi = 1024 ** 2;
const Gi = 1024 ** 3;
const resources = { cpuMillis: 1000, memoryBytes: 512 * Mi };
const createdAt = Date.now();

function node(name: string, cpu = "8", memory = "24Gi"): V1Node {
  return {
    metadata: { name, labels: { "nojv-role": "sandbox" } },
    status: { allocatable: { cpu, memory }, conditions: [{ type: "Ready", status: "True" }] },
  };
}

function request(
  studentId: string,
  runId = studentId,
  phase: JudgeAdmissionRequest["phase"] = "prepare",
  requestId = `${runId}-${phase}`,
): JudgeAdmissionRequest {
  return {
    requestId,
    runId,
    studentId,
    phase,
    resources,
    maximumUnits: phase === "wave" ? 20 : 1,
    sequence: phase === "wave" ? (requestId.endsWith("2") ? 2 : 1) : 0,
    createdAt,
  };
}

function state(nodes = [node("node-a")]): JudgeAdmissionState {
  const result = createAdmissionState();
  updateCapacitySnapshot(result, buildCapacitySnapshot(nodes, [], [], 0, "judge"));
  return result;
}

function prepare(s: JudgeAdmissionState, studentId: string): void {
  enqueueAdmission(s, request(studentId));
  const permit = admitAvailable(s, 0).granted.find((p) => p.request.studentId === studentId)!;
  expect(permit).toBeDefined();
  confirmPermitCleanup(s, studentId, permit.permitId, true);
}

describe("Kubernetes resource accounting", () => {
  it("parses CPU, binary, decimal and exponent quantities with conservative rounding", () => {
    expect(parseResourceQuantity("250m", true)).toBe(250);
    expect(parseResourceQuantity("0.0001", true)).toBe(1);
    expect(parseResourceQuantity("1.5Gi")).toBe(1.5 * Gi);
    expect(parseResourceQuantity("129e6")).toBe(129_000_000);
    expect(parseResourceQuantity("400m")).toBe(1);
    expect(() => parseResourceQuantity("-1Gi")).toThrow();
    expect(() => parseResourceQuantity("100Ei")).toThrow();
    expect(() => parseResourceQuantity("garbage")).toThrow();
  });

  it("accounts restartable init sidecars throughout later init and application phases", () => {
    const pod: V1Pod = {
      spec: {
        containers: [{ name: "app", resources: { requests: { cpu: "1", memory: "128Mi" } } }],
        initContainers: [
          {
            name: "sidecar",
            restartPolicy: "Always",
            resources: { limits: { cpu: "500m", memory: "64Mi" } },
          },
          { name: "setup", resources: { requests: { cpu: "2", memory: "256Mi" } } },
          {
            name: "sidecar-2",
            restartPolicy: "Always",
            resources: { requests: { cpu: "100m", memory: "1Gi" } },
          },
        ],
        overhead: { cpu: "50m", memory: "32Mi" },
      },
    };
    expect(effectivePodRequests(pod)).toEqual({
      cpuMillis: 2550,
      memoryBytes: (128 + 64 + 1024 + 32) * Mi,
    });
  });

  it("uses per-resource pod-level requests and adds RuntimeClass overhead exactly once", () => {
    expect(
      effectivePodRequests({
        spec: {
          containers: [{ name: "app", resources: { limits: { cpu: "2", memory: "1Gi" } } }],
          resources: { requests: { cpu: "3" } },
          overhead: { cpu: "100m", memory: "64Mi" },
        },
      }),
    ).toEqual({ cpuMillis: 3100, memoryBytes: Gi + 64 * Mi });
  });

  it("budgets heterogeneous nodes against nonjudge requests, excluding only terminal and judge Pods", () => {
    const pods: V1Pod[] = [
      {
        metadata: { namespace: "system" },
        spec: {
          nodeName: "a",
          containers: [{ name: "db", resources: { requests: { cpu: "3", memory: "8Gi" } } }],
        },
      },
      {
        metadata: { namespace: "judge" },
        spec: {
          nodeName: "a",
          containers: [{ name: "case", resources: { requests: { cpu: "2" } } }],
        },
      },
      {
        metadata: { namespace: "system" },
        status: { phase: "Succeeded" },
        spec: {
          nodeName: "a",
          containers: [{ name: "old", resources: { requests: { cpu: "7" } } }],
        },
      },
    ];
    const snapshot = buildCapacitySnapshot(
      [node("a"), node("b", "4", "8Gi")],
      pods,
      [],
      10,
      "judge",
    );
    expect(snapshot.nodes.map((n) => n.budget)).toEqual([
      { cpuMillis: 5000, memoryBytes: 16 * Gi },
      { cpuMillis: 3000, memoryBytes: 6 * Gi },
    ]);
    expect(snapshot.observedAt).toBe(10);
  });

  it("retains unavailable nodes as potential capacity but excludes drain, NotReady and FailedKillPod quarantine", () => {
    const drained = node("drained");
    drained.spec = { unschedulable: true };
    const notReady = node("not-ready");
    notReady.status!.conditions![0]!.status = "False";
    const unlabeled = node("other");
    unlabeled.metadata!.labels = {};
    const snapshot = buildCapacitySnapshot(
      [node("ok"), drained, notReady, node("stuck"), unlabeled],
      [],
      ["stuck"],
      0,
      "judge",
    );
    expect(snapshot.nodes.filter((n) => n.eligible).map((n) => n.name)).toEqual(["ok"]);
    expect(snapshot.nodes).toHaveLength(4);
  });
});

describe("durable admission state", () => {
  it("stops new admissions when snapshots exceed 90 seconds, preserving held permits", () => {
    const s = state();
    enqueueAdmission(s, request("a"));
    const [held] = admitAvailable(s, 0).granted;
    enqueueAdmission(s, request("b"));
    expect(admitAvailable(s, 90_001).granted).toEqual([]);
    expect(s.permits).toEqual([held]);
    updateCapacitySnapshot(s, { ...s.snapshot!, observedAt: 90_001 });
    expect(admitAvailable(s, 90_001).granted).toHaveLength(1);
    updateCapacitySnapshot(s, { observedAt: 1, nodes: [] });
    expect(s.snapshot!.nodes).toHaveLength(1);
  });

  it("caps waves at four and shrinks them to the artifact node's remaining CPU and memory", () => {
    const s = state([node("a"), node("b", "4", "2Gi")]);
    prepare(s, "s1");
    prepare(s, "s2");
    enqueueAdmission(s, { ...request("s1", "s1", "wave"), nodeName: "a" });
    enqueueAdmission(s, {
      ...request("s2", "s2", "wave"),
      nodeName: "b",
      overhead: { cpuMillis: 100, memoryBytes: 64 * Mi },
    });
    const grants = admitAvailable(s, 0).granted;
    expect(grants.map((p) => [p.nodeName, p.units])).toEqual([
      ["a", 4],
      ["b", 2],
    ]);
    expect(grants[1]!.resources).toEqual({ cpuMillis: 2100, memoryBytes: 1088 * Mi });
  });

  it("round-robins students, preserves submission FIFO and requeues a completed wave at the back", () => {
    const s = state([node("a", "4")]);
    prepare(s, "alice");
    prepare(s, "bob");
    enqueueAdmission(s, request("alice", "alice", "wave"));
    enqueueAdmission(s, request("alice", "alice-later"));
    enqueueAdmission(s, request("bob", "bob", "wave"));
    const [a] = admitAvailable(s, 0).granted;
    expect(a!.request.studentId).toBe("alice");
    expect(a!.units).toBe(3);
    enqueueAdmission(s, request("alice", "alice", "wave", "alice-wave-2"));
    expect(admitAvailable(s, 0).granted).toEqual([]);
    confirmPermitCleanup(s, "alice", a!.permitId, true);
    const [b] = admitAvailable(s, 0).granted;
    expect(b!.request.studentId).toBe("bob");
    confirmPermitCleanup(s, "bob", b!.permitId, true);
    const [a2] = admitAvailable(s, 0).granted;
    expect(a2!.request.requestId).toBe("alice-wave-2");
    expect(s.pending.some((r) => r.runId === "alice-later")).toBe(true);
  });

  it("retains resource commitments after budget shrink, quarantine and elapsed time until confirmed cleanup", () => {
    const s = state([node("a", "4"), node("b", "4")]);
    prepare(s, "alice");
    enqueueAdmission(s, { ...request("alice", "alice", "wave"), nodeName: "a" });
    const [permit] = admitAvailable(s, 0).granted;
    updateCapacitySnapshot(
      s,
      buildCapacitySnapshot([node("a", "2"), node("b", "4")], [], ["a"], 100_000, "judge"),
    );
    enqueueAdmission(s, request("bob"));
    expect(admitAvailable(s, 100_000).granted[0]!.nodeName).toBe("b");
    expect(confirmPermitCleanup(s, "alice", permit!.permitId, false)).toBe(false);
    expect(confirmPermitCleanup(s, "different-run", permit!.permitId, true)).toBe(false);
    expect(finishAdmissionRun(s, "alice", true)).toBe(false);
    expect(permit!.cleanupConfirmed).toBe(false);
    expect(confirmPermitCleanup(s, "alice", permit!.permitId, true)).toBe(true);
    expect(confirmPermitCleanup(s, "alice", permit!.permitId, true)).toBe(true);
    expect(finishAdmissionRun(s, "alice", true)).toBe(true);
  });

  it("deduplicates requests and rejects conflicting IDs across runs even after cleanup", () => {
    const s = state();
    const req = request("alice");
    enqueueAdmission(s, req);
    enqueueAdmission(s, structuredClone(req));
    expect(s.pending).toHaveLength(1);
    const [permit] = admitAvailable(s, 0).granted;
    confirmPermitCleanup(s, "alice", permit!.permitId, true);
    enqueueAdmission(s, req);
    expect(s.pending).toEqual([]);
    expect(() => enqueueAdmission(s, { ...req, runId: "new-run" })).toThrow("reused");
  });

  it("holds prepared slots until final artifact cleanup, limiting unfinished prepares to twice CPU slots", () => {
    const s = state([node("a", "2")]);
    prepare(s, "a");
    prepare(s, "b");
    enqueueAdmission(s, request("c"));
    expect(admitAvailable(s, 0).granted).toEqual([]);
    expect(finishAdmissionRun(s, "a", false)).toBe(false);
    expect(admitAvailable(s, 0).granted).toEqual([]);
    expect(finishAdmissionRun(s, "a", true)).toBe(true);
    expect(admitAvailable(s, 0).granted[0]!.request.runId).toBe("c");
  });

  it("distinguishes impossible resources from unavailable nodes and temporary resource pressure", () => {
    const s = state([node("a", "4", "4Gi")]);
    enqueueAdmission(s, {
      ...request("large"),
      resources: { cpuMillis: 1000, memoryBytes: 4 * Gi },
    });
    expect(admitAvailable(s, 0).rejected[0]!.reason).toBe("resource_request_unsatisfiable");
    enqueueAdmission(s, { ...request("missing"), nodeName: "not-yet-ready" });
    expect(admitAvailable(s, 0).rejected[0]!.reason).toBe("artifact_node_unavailable");
    s.snapshot!.nodes[0]!.eligible = false;
    enqueueAdmission(s, request("unready"));
    expect(admitAvailable(s, 0)).toEqual({ granted: [], rejected: [] });
    s.snapshot!.nodes[0]!.eligible = true;
    s.snapshot!.nodes[0]!.budget = { cpuMillis: 100, memoryBytes: Mi };
    expect(admitAvailable(s, 0)).toEqual({ granted: [], rejected: [] });
  });

  it("cancels queued messages idempotently without releasing in-flight execution or prepared capacity", () => {
    const s = state();
    enqueueAdmission(s, request("a"));
    const [permit] = admitAvailable(s, 0).granted;
    enqueueAdmission(s, request("a", "a", "wave"));
    cancelQueuedRun(s, "a");
    enqueueAdmission(s, request("a", "a", "wave"));
    expect(s.pending).toEqual([]);
    expect(permit!.cleanupConfirmed).toBe(false);
    expect(s.runs[0]!.prepared).toBe(true);
  });

  it("tombstones cancellation before the first admission request arrives", () => {
    const s = state();
    cancelQueuedRun(s, "late-run");
    cancelQueuedRun(s, "late-run");
    enqueueAdmission(s, request("alice", "late-run"));
    expect(admitAvailable(s, 0).granted).toEqual([]);
    expect(s.pending).toEqual([]);
    expect(s.runs).toEqual([]);
    expect(s.cancelledRunIds).toEqual(["late-run"]);
    expect(s.cancelled).toHaveLength(1);
  });

  it("rejects distinct delayed wave requests after cancellation without releasing held permits", () => {
    const s = state();
    prepare(s, "alice");
    enqueueAdmission(s, request("alice", "alice", "wave", "wave-1"));
    const [permit] = admitAvailable(s, 0).granted;
    cancelQueuedRun(s, "alice");
    enqueueAdmission(s, request("alice", "alice", "wave", "wave-2"));
    expect(s.pending).toEqual([]);
    expect(permit!.cleanupConfirmed).toBe(false);
    confirmPermitCleanup(s, "alice", permit!.permitId, true);
    expect(admitAvailable(s, 0).granted).toEqual([]);
    expect(s.cancelled.map((r) => r.requestId)).toEqual(["wave-2"]);
  });

  it("lets a blocked large wave collect capacity instead of starving behind endless small waves", () => {
    const s = state([node("a", "4", "4Gi"), node("b", "4", "4Gi")]);
    prepare(s, "large");
    prepare(s, "small");
    enqueueAdmission(s, { ...request("already-running"), nodeName: "a" });
    const [running] = admitAvailable(s, 0).granted;
    enqueueAdmission(s, {
      ...request("large", "large", "wave"),
      nodeName: "a",
      resources: { cpuMillis: 1000, memoryBytes: 3 * Gi },
    });
    enqueueAdmission(s, { ...request("small", "small", "wave"), nodeName: "a" });
    enqueueAdmission(s, { ...request("healthy-node"), nodeName: "b" });
    expect(admitAvailable(s, 0).granted.map((p) => p.request.runId)).toEqual(["healthy-node"]);
    confirmPermitCleanup(s, "already-running", running!.permitId, true);
    expect(admitAvailable(s, 0).granted.map((p) => p.request.runId)).toEqual(["large"]);
  });

  it("uses a newly added node without dropping existing commitments", () => {
    const s = state([node("a", "2")]);
    enqueueAdmission(s, request("first"));
    admitAvailable(s, 0);
    enqueueAdmission(s, request("waiting"));
    expect(admitAvailable(s, 0).granted).toEqual([]);
    updateCapacitySnapshot(
      s,
      buildCapacitySnapshot([node("a", "2"), node("b", "4")], [], [], 30_000, "judge"),
    );
    expect(admitAvailable(s, 30_000).granted[0]!.nodeName).toBe("b");
    expect(s.permits.filter((p) => !p.cleanupConfirmed)).toHaveLength(2);
  });

  it("restores its complete state from JSON without admitting duplicates", () => {
    const s = state();
    enqueueAdmission(s, request("alice"));
    admitAvailable(s, 0);
    const restored: JudgeAdmissionState = JSON.parse(JSON.stringify(s));
    enqueueAdmission(restored, request("alice"));
    expect(admitAvailable(restored, 0).granted).toEqual([]);
    expect(restored).toEqual(s);
  });

  it("compacts completed wave permits while preserving sequence fencing and active reservations", () => {
    const s = state();
    prepare(s, "alice");
    compactAdmissionState(s, createdAt);
    expect(s.permits).toEqual([]);
    enqueueAdmission(s, request("alice"));
    expect(s.pending).toEqual([]);
    const first = request("alice", "alice", "wave", "wave-1");
    enqueueAdmission(s, first);
    const [permit] = admitAvailable(s, 0).granted;
    compactAdmissionState(s, createdAt + ADMISSION_TOMBSTONE_RETENTION_MS * 2);
    expect(s.permits).toEqual([permit]);
    confirmPermitCleanup(s, "alice", permit!.permitId, true);
    compactAdmissionState(s, createdAt);
    enqueueAdmission(s, first);
    expect(s.pending).toEqual([]);
    expect(s.permits).toEqual([]);
    enqueueAdmission(s, request("alice", "alice", "wave", "wave-2"));
    expect(admitAvailable(s, 0).granted).toHaveLength(1);
  });

  it("retains compact run tombstones then rejects stale first messages after their expiry", () => {
    const s = state();
    prepare(s, "alice");
    finishAdmissionRun(s, "alice", true, createdAt);
    compactAdmissionState(s, createdAt);
    expect(s.runs).toEqual([]);
    expect(s.studentOrder).toEqual([]);
    expect(s.permits).toEqual([]);
    expect(s.closedRuns).toEqual([{ runId: "alice", closedAt: createdAt }]);
    enqueueAdmission(s, request("alice"), createdAt);
    expect(s.pending).toEqual([]);
    const expiredAt = createdAt + ADMISSION_TOMBSTONE_RETENTION_MS + 1;
    compactAdmissionState(s, expiredAt);
    expect(s.closedRuns).toEqual([]);
    expect(s.cancelledRunIds).toEqual([]);
    expect(() => enqueueAdmission(s, request("alice"), expiredAt)).toThrow("Stale");
    expect(s.pending).toEqual([]);
  });

  it("rejects unknown later sequences and conflicting sequence IDs", () => {
    const s = state();
    expect(() => enqueueAdmission(s, request("alice", "alice", "wave"))).toThrow(
      "out-of-order",
    );
    enqueueAdmission(s, request("alice"));
    expect(() =>
      enqueueAdmission(s, { ...request("alice"), requestId: "different", phase: "other" }),
    ).toThrow("sequence reused");
  });

  it("never expires a queued or cancellation-held live run during compaction", () => {
    const s = state();
    enqueueAdmission(s, request("alice"));
    const future = createdAt + ADMISSION_TOMBSTONE_RETENTION_MS * 2;
    compactAdmissionState(s, future);
    updateCapacitySnapshot(s, { ...s.snapshot!, observedAt: future });
    const [permit] = admitAvailable(s, future).granted;
    expect(permit).toBeDefined();
    cancelQueuedRun(s, "alice", createdAt);
    compactAdmissionState(s, future);
    expect(s.permits).toEqual([permit]);
    expect(s.cancelledRunIds).toEqual(["alice"]);
    expect(finishAdmissionRun(s, "alice", true, future)).toBe(false);
  });

  it("drains 100 students with 25 waves each without carrying completed wave history forward", () => {
    const s = state();
    for (let index = 0; index < 100; index++) enqueueAdmission(s, request(`student-${index}`));
    let completed = 0;
    for (let iteration = 0; completed < 100 && iteration < 3000; iteration++) {
      const grants = admitAvailable(s, 0).granted;
      expect(grants.length).toBeGreaterThan(0);
      for (const permit of grants) {
        const { runId, studentId } = permit.request;
        confirmPermitCleanup(s, runId, permit.permitId, true);
        const nextSequence = permit.request.sequence! + 1;
        if (nextSequence > 25) {
          expect(finishAdmissionRun(s, runId, true, createdAt)).toBe(true);
          completed++;
        } else {
          enqueueAdmission(s, {
            ...request(studentId, runId, "wave", `${runId}-wave-${nextSequence}`),
            sequence: nextSequence,
          });
        }
      }
      compactAdmissionState(s, createdAt);
      expect(s.permits).toEqual([]);
      expect(s.runs.length + s.closedRuns.length).toBe(100);
    }
    expect(completed).toBe(100);
    expect(s.studentOrder).toEqual([]);
    expect(s.closedRuns).toHaveLength(100);
    expect(JSON.stringify(s).length).toBeLessThan(20_000);
  });

  it("holds a later ready submission behind an earlier registered submission still loading data", () => {
    const s = state();
    registerAdmissionRun(s, {
      runId: "older",
      studentId: "alice",
      submittedAt: 100,
      createdAt,
    });
    registerAdmissionRun(s, {
      runId: "newer",
      studentId: "alice",
      submittedAt: 200,
      createdAt,
    });
    enqueueAdmission(s, request("alice", "newer"));
    enqueueAdmission(s, request("bob"));
    const grants = admitAvailable(s, 0).granted;
    expect(grants.map((permit) => permit.request.studentId)).toEqual(["bob"]);
    enqueueAdmission(s, request("alice", "older"));
    const [older] = admitAvailable(s, 0).granted;
    expect(older!.request.runId).toBe("older");
    confirmPermitCleanup(s, "older", older!.permitId, true);
    expect(admitAvailable(s, 0).granted).toEqual([]);
    finishAdmissionRun(s, "older", true);
    expect(admitAvailable(s, 0).granted[0]!.request.runId).toBe("newer");
  });

  it("retains FIFO while a cleaned attempt waits to register its retry", () => {
    const s = state();
    registerAdmissionRun(s, { runId: "old", studentId: "alice", submittedAt: 100, createdAt });
    registerAdmissionRun(s, {
      runId: "later",
      studentId: "alice",
      submittedAt: 200,
      createdAt,
    });
    enqueueAdmission(s, request("alice", "old"));
    enqueueAdmission(s, request("alice", "later"));
    const first = admitAvailable(s, 0).granted[0]!;
    confirmPermitCleanup(s, "old", first.permitId, true);
    cancelQueuedRun(s, "old");
    compactAdmissionState(s, createdAt);
    expect(admitAvailable(s, 0).granted).toEqual([]);
    registerAdmissionRun(s, {
      runId: "retry",
      replacesRunId: "old",
      studentId: "alice",
      submittedAt: 100,
      createdAt,
    });
    enqueueAdmission(s, request("alice", "retry"));
    const retry = admitAvailable(s, 0).granted[0]!;
    expect(retry.request.runId).toBe("retry");
    confirmPermitCleanup(s, "retry", retry.permitId, true);
    finishAdmissionRun(s, "retry", true);
    expect(admitAvailable(s, 0).granted[0]!.request.runId).toBe("later");
  });

  it("keeps the submission tie-breaker stable when a retry changes run ID", () => {
    const s = state();
    registerAdmissionRun(s, { runId: "a", studentId: "alice", submittedAt: 100, createdAt });
    registerAdmissionRun(s, { runId: "b", studentId: "alice", submittedAt: 100, createdAt });
    cancelQueuedRun(s, "a");
    registerAdmissionRun(s, {
      runId: "z",
      replacesRunId: "a",
      studentId: "alice",
      submittedAt: 100,
      createdAt,
    });
    enqueueAdmission(s, request("alice", "z"));
    enqueueAdmission(s, request("alice", "b"));
    expect(admitAvailable(s, 0).granted[0]!.request.runId).toBe("z");
  });

  it("cannot replace a run before cleanup or under another student's identity", () => {
    const s = state();
    registerAdmissionRun(s, { runId: "old", studentId: "alice", submittedAt: 100, createdAt });
    enqueueAdmission(s, request("alice", "old"));
    const first = admitAvailable(s, 0).granted[0]!;
    const replacement = {
      runId: "retry",
      replacesRunId: "old",
      studentId: "alice",
      submittedAt: 100,
      createdAt,
    };
    expect(() => registerAdmissionRun(s, replacement)).toThrow("Retry cannot replace");
    confirmPermitCleanup(s, "old", first.permitId, true);
    expect(() => registerAdmissionRun(s, { ...replacement, studentId: "bob" })).toThrow(
      "Retry cannot replace",
    );
    expect(s.runs.find((run) => run.runId === "old")?.finished).toBe(false);
  });

  it("orders registered submissions by submittedAt and stable run ID, not signal arrival", () => {
    const s = state();
    for (const runId of ["newer", "older-b", "older-a"]) {
      registerAdmissionRun(s, {
        runId,
        studentId: "alice",
        submittedAt: runId === "newer" ? 200 : 100,
        createdAt,
      });
      enqueueAdmission(s, request("alice", runId));
    }
    expect(admitAvailable(s, 0).granted[0]!.request.runId).toBe("older-a");
  });

  it("allows old submissions and indefinitely waiting registrations without reviving stale messages", () => {
    const s = state();
    const registration = { runId: "alice", studentId: "alice", submittedAt: 1, createdAt };
    registerAdmissionRun(s, registration);
    registerAdmissionRun(s, registration);
    expect(s.runs).toHaveLength(1);
    const later = createdAt + ADMISSION_TOMBSTONE_RETENTION_MS * 2;
    compactAdmissionState(s, later);
    enqueueAdmission(s, request("alice"), later);
    updateCapacitySnapshot(s, { ...s.snapshot!, observedAt: later });
    const [permit] = admitAvailable(s, later).granted;
    expect(permit!.request.runId).toBe("alice");
    confirmPermitCleanup(s, "alice", permit!.permitId, true);
    finishAdmissionRun(s, "alice", true, later);
    const expired = later + ADMISSION_TOMBSTONE_RETENTION_MS + 1;
    compactAdmissionState(s, expired);
    expect(() => registerAdmissionRun(s, registration, expired)).toThrow("Stale registration");
    expect(s.runs).toEqual([]);
  });

  it("does not let a delayed registration undo cancellation", () => {
    const s = state();
    cancelQueuedRun(s, "alice");
    registerAdmissionRun(s, { runId: "alice", studentId: "alice", submittedAt: 1, createdAt });
    expect(s.runs).toEqual([]);
    expect(s.cancelledRunIds).toEqual(["alice"]);
  });

  it("rejects a wave on a removed artifact node while healthy-node permits remain usable", () => {
    const s = state([node("a"), node("b")]);
    prepare(s, "alice");
    enqueueAdmission(s, { ...request("alice", "alice", "wave"), nodeName: "a" });
    enqueueAdmission(s, request("bob"));
    updateCapacitySnapshot(s, buildCapacitySnapshot([node("b")], [], [], 30_000, "judge"));
    const result = admitAvailable(s, 30_000);
    expect(result.rejected.map((rejected) => rejected.reason)).toEqual([
      "artifact_node_unavailable",
    ]);
    expect(result.granted.map((permit) => permit.request.studentId)).toEqual(["bob"]);
  });
});
