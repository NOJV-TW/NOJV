import type { V1Node, V1Pod, V1ResourceRequirements } from "@kubernetes/client-node";

export interface JudgeResources {
  cpuMillis: number;
  memoryBytes: number;
}

export interface JudgeCapacityNode {
  name: string;
  eligible: boolean;
  allocatable: JudgeResources;
  budget: JudgeResources;
}

export interface JudgeCapacitySnapshot {
  observedAt: number;
  nodes: JudgeCapacityNode[];
}

export interface JudgeAdmissionRequest {
  requestId: string;
  runId: string;
  studentId: string;
  phase: "prepare" | "wave" | "other";
  resources: JudgeResources;
  overhead?: JudgeResources;
  maximumUnits: number;
  nodeName?: string;
  sequence?: number;
  createdAt?: number;
}

export interface JudgePermit {
  permitId: string;
  request: JudgeAdmissionRequest;
  nodeName: string;
  units: number;
  resources: JudgeResources;
  cleanupConfirmed: boolean;
}

export interface JudgeRunRegistration {
  runId: string;
  replacesRunId?: string;
  submissionId?: string;
  studentId: string;
  submittedAt: number;
  createdAt: number;
  priority?: number;
}

export interface JudgeAdmissionState {
  snapshot?: JudgeCapacitySnapshot;
  studentOrder: string[];
  runs: {
    runId: string;
    studentId: string;
    prepared: boolean;
    finished: boolean;
    lastCompletedSequence: number;
    orderKey: string;
    submittedAt: number;
    registeredAt: number;
    priority?: number;
  }[];
  pending: JudgeAdmissionRequest[];
  permits: JudgePermit[];
  rejected: {
    request: JudgeAdmissionRequest;
    reason: "resource_request_unsatisfiable" | "artifact_node_unavailable";
  }[];
  cancelled: JudgeAdmissionRequest[];
  cancelledRunIds: string[];
  closedRuns: { runId: string; closedAt: number }[];
}

export const ADMISSION_TOMBSTONE_RETENTION_MS = 24 * 60 * 60 * 1000;

const zero = (): JudgeResources => ({ cpuMillis: 0, memoryBytes: 0 });
const add = (a: JudgeResources, b: JudgeResources): JudgeResources => ({
  cpuMillis: a.cpuMillis + b.cpuMillis,
  memoryBytes: a.memoryBytes + b.memoryBytes,
});
const max = (a: JudgeResources, b: JudgeResources): JudgeResources => ({
  cpuMillis: Math.max(a.cpuMillis, b.cpuMillis),
  memoryBytes: Math.max(a.memoryBytes, b.memoryBytes),
});
const scale = (a: JudgeResources, n: number): JudgeResources => ({
  cpuMillis: a.cpuMillis * n,
  memoryBytes: a.memoryBytes * n,
});
const fits = (a: JudgeResources, b: JudgeResources): boolean =>
  a.cpuMillis <= b.cpuMillis && a.memoryBytes <= b.memoryBytes;

export function parseResourceQuantity(value: string | undefined, cpu = false): number {
  if (value === undefined) return 0;
  const match = /^([+]?(?:\d+(?:\.\d*)?|\.\d+))([eE][+-]?\d+|[numkKMGTPE]|[KMGTPE]i)?$/.exec(
    value,
  );
  if (!match) throw new Error(`Invalid Kubernetes resource quantity: ${value}`);
  const suffix = match[2] ?? "";
  const decimal: Record<string, number> = {
    n: -9,
    u: -6,
    m: -3,
    k: 3,
    K: 3,
    M: 6,
    G: 9,
    T: 12,
    P: 15,
    E: 18,
  };
  const binary = ["Ki", "Mi", "Gi", "Ti", "Pi", "Ei"].indexOf(suffix);
  const factor =
    binary >= 0
      ? 1024 ** (binary + 1)
      : suffix === ""
        ? 1
        : suffix in decimal
          ? 10 ** (decimal[suffix] ?? 0)
          : 10 ** Number(suffix.slice(1));
  const quantity = Math.ceil(Number(match[1]) * factor * (cpu ? 1000 : 1));
  if (!Number.isSafeInteger(quantity) || quantity < 0)
    throw new Error(`Unsafe Kubernetes resource quantity: ${value}`);
  return quantity;
}

function resourceRequests(resources?: V1ResourceRequirements): JudgeResources {
  return {
    cpuMillis: parseResourceQuantity(resources?.requests?.cpu ?? resources?.limits?.cpu, true),
    memoryBytes: parseResourceQuantity(
      resources?.requests?.memory ?? resources?.limits?.memory,
    ),
  };
}

export function effectivePodRequests(pod: V1Pod): JudgeResources {
  let apps = zero();
  for (const container of pod.spec?.containers ?? [])
    apps = add(apps, resourceRequests(container.resources));
  let sidecars = zero();
  let initPeak = zero();
  for (const container of pod.spec?.initContainers ?? []) {
    const requested = resourceRequests(container.resources);
    if (container.restartPolicy === "Always") {
      sidecars = add(sidecars, requested);
      initPeak = max(initPeak, sidecars);
    } else {
      initPeak = max(initPeak, add(sidecars, requested));
    }
  }
  const effective = max(add(apps, sidecars), initPeak);
  const podResources = pod.spec?.resources;
  if (podResources?.requests?.cpu !== undefined || podResources?.limits?.cpu !== undefined) {
    effective.cpuMillis = resourceRequests(podResources).cpuMillis;
  }
  if (
    podResources?.requests?.memory !== undefined ||
    podResources?.limits?.memory !== undefined
  ) {
    effective.memoryBytes = resourceRequests(podResources).memoryBytes;
  }
  return add(effective, resourceRequests({ requests: pod.spec?.overhead ?? {} }));
}

export function buildCapacitySnapshot(
  nodes: V1Node[],
  pods: V1Pod[],
  quarantinedNodeNames: string[],
  observedAt: number,
  judgeNamespace: string,
): JudgeCapacitySnapshot {
  const committed = new Map<string, JudgeResources>();
  for (const pod of pods) {
    if (
      !pod.spec?.nodeName ||
      pod.metadata?.namespace === judgeNamespace ||
      ["Succeeded", "Failed"].includes(pod.status?.phase ?? "")
    )
      continue;
    committed.set(
      pod.spec.nodeName,
      add(committed.get(pod.spec.nodeName) ?? zero(), effectivePodRequests(pod)),
    );
  }
  return {
    observedAt,
    nodes: nodes
      .filter((node) => node.metadata?.labels?.["nojv-role"] === "sandbox")
      .map((node) => {
        const name = node.metadata?.name;
        if (!name) throw new Error("Capacity node has no name");
        const allocatable = resourceRequests({ requests: node.status?.allocatable ?? {} });
        const reserved = max(committed.get(name) ?? zero(), scale(allocatable, 0.25));
        return {
          name,
          eligible:
            !node.spec?.unschedulable &&
            !node.metadata?.deletionTimestamp &&
            !quarantinedNodeNames.includes(name) &&
            !node.status?.conditions?.some(
              (c) =>
                ["MemoryPressure", "DiskPressure", "PIDPressure"].includes(c.type) &&
                c.status !== "False",
            ) &&
            node.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True") ===
              true,
          allocatable,
          budget: {
            cpuMillis: Math.max(0, Math.floor(allocatable.cpuMillis - reserved.cpuMillis)),
            memoryBytes: Math.max(
              0,
              Math.floor(allocatable.memoryBytes - reserved.memoryBytes),
            ),
          },
        };
      })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  };
}

export function createAdmissionState(): JudgeAdmissionState {
  return {
    studentOrder: [],
    runs: [],
    pending: [],
    permits: [],
    rejected: [],
    cancelled: [],
    cancelledRunIds: [],
    closedRuns: [],
  };
}

export function updateCapacitySnapshot(
  state: JudgeAdmissionState,
  snapshot: JudgeCapacitySnapshot,
): void {
  if (!state.snapshot || snapshot.observedAt >= state.snapshot.observedAt)
    state.snapshot = snapshot;
}

export function registerAdmissionRun(
  state: JudgeAdmissionState,
  registration: JudgeRunRegistration,
  now = Date.now(),
): void {
  if (
    !registration.runId ||
    !registration.studentId ||
    !Number.isSafeInteger(registration.submittedAt) ||
    registration.submittedAt < 0 ||
    !Number.isSafeInteger(registration.createdAt) ||
    registration.createdAt < 0 ||
    registration.createdAt > now
  )
    throw new Error("Invalid admission run registration");
  if (state.cancelledRunIds.includes(registration.runId)) return;
  const existing = state.runs.find((run) => run.runId === registration.runId);
  if (existing) {
    if (
      existing.studentId !== registration.studentId ||
      existing.submittedAt !== registration.submittedAt ||
      existing.registeredAt !== registration.createdAt ||
      (registration.submissionId !== undefined &&
        existing.orderKey !== registration.submissionId)
    )
      throw new Error("Admission run registration reused with different contents");
    return;
  }
  if (now - registration.createdAt > ADMISSION_TOMBSTONE_RETENTION_MS)
    throw new Error("Stale registration for unknown admission run");
  let orderKey = registration.submissionId ?? registration.runId;
  let priority = registration.priority;
  if (registration.replacesRunId !== undefined) {
    const previous = state.runs.find((run) => run.runId === registration.replacesRunId);
    if (
      !previous ||
      previous.finished ||
      previous.studentId !== registration.studentId ||
      previous.submittedAt !== registration.submittedAt ||
      (registration.submissionId !== undefined &&
        registration.submissionId !== previous.orderKey) ||
      state.permits.some(
        (permit) => permit.request.runId === previous.runId && !permit.cleanupConfirmed,
      )
    )
      throw new Error("Retry cannot replace an active or unrelated admission run");
    orderKey = previous.orderKey;
    priority ??= previous.priority;
    finishAdmissionRun(state, previous.runId, true, now);
  }
  state.runs.push({
    runId: registration.runId,
    studentId: registration.studentId,
    submittedAt: registration.submittedAt,
    registeredAt: registration.createdAt,
    prepared: false,
    finished: false,
    lastCompletedSequence: -1,
    orderKey,
    ...(priority !== undefined ? { priority } : {}),
  });
  sortAdmissionRuns(state);
  if (!state.studentOrder.includes(registration.studentId))
    state.studentOrder.push(registration.studentId);
}

const runPriority = (run: { priority?: number }): number => run.priority ?? 0;

function sortAdmissionRuns(state: JudgeAdmissionState): void {
  state.runs.sort(
    (a, b) =>
      runPriority(a) - runPriority(b) ||
      a.submittedAt - b.submittedAt ||
      (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0),
  );
}

export function assignAdmissionRunPriorities(
  state: JudgeAdmissionState,
  priorities: Record<string, number>,
): number {
  let assigned = 0;
  for (const run of state.runs) {
    const priority = priorities[run.orderKey];
    if (run.finished || run.priority !== undefined || priority === undefined) continue;
    if (!Number.isSafeInteger(priority) || priority < 0)
      throw new Error("Admission run priority must be a non-negative integer");
    run.priority = priority;
    assigned++;
  }
  if (assigned > 0) sortAdmissionRuns(state);
  return assigned;
}

export function enqueueAdmission(
  state: JudgeAdmissionState,
  request: JudgeAdmissionRequest,
  now = Date.now(),
): void {
  const sequence = request.sequence ?? 0;
  const createdAt = request.createdAt ?? now;
  for (const resource of [request.resources, request.overhead ?? zero()]) {
    if (
      !Number.isSafeInteger(resource.cpuMillis) ||
      !Number.isSafeInteger(resource.memoryBytes) ||
      resource.cpuMillis < 0 ||
      resource.memoryBytes < 0
    )
      throw new Error("Admission resources must be nonnegative integers");
  }
  if (
    request.resources.cpuMillis <= 0 ||
    request.resources.memoryBytes <= 0 ||
    !Number.isSafeInteger(request.maximumUnits) ||
    request.maximumUnits < 1 ||
    !request.requestId ||
    !request.runId ||
    !request.studentId ||
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0 ||
    createdAt > now
  )
    throw new Error("Invalid admission request");
  const existing = [
    ...state.pending,
    ...state.permits.map((p) => p.request),
    ...state.rejected.map((r) => r.request),
    ...state.cancelled,
  ].find((r) => r.requestId === request.requestId);
  if (existing) {
    if (
      existing.runId !== request.runId ||
      existing.studentId !== request.studentId ||
      existing.phase !== request.phase ||
      existing.nodeName !== request.nodeName ||
      existing.maximumUnits !== request.maximumUnits ||
      existing.sequence !== request.sequence ||
      existing.createdAt !== request.createdAt ||
      existing.resources.cpuMillis !== request.resources.cpuMillis ||
      existing.resources.memoryBytes !== request.resources.memoryBytes ||
      (existing.overhead?.cpuMillis ?? 0) !== (request.overhead?.cpuMillis ?? 0) ||
      (existing.overhead?.memoryBytes ?? 0) !== (request.overhead?.memoryBytes ?? 0)
    )
      throw new Error("Admission request ID reused with different contents");
    return;
  }
  if (state.cancelledRunIds.includes(request.runId)) {
    state.cancelled.push(request);
    return;
  }
  const run = state.runs.find((r) => r.runId === request.runId);
  if (run && (run.finished || run.studentId !== request.studentId))
    throw new Error("Admission run is finished or owned by another student");
  if (run && sequence <= run.lastCompletedSequence) return;
  const sameSequence = [
    ...state.pending,
    ...state.permits.map((permit) => permit.request),
  ].find((r) => r.runId === request.runId && (r.sequence ?? 0) === sequence);
  if (sameSequence) throw new Error("Admission sequence reused with a different request ID");
  if (
    request.phase === "prepare" &&
    (run?.prepared ||
      state.pending.some((r) => r.runId === request.runId && r.phase === "prepare"))
  )
    throw new Error("Run already has a prepare request");
  if (!run) {
    if (
      sequence !== 0 ||
      request.phase === "wave" ||
      now - createdAt > ADMISSION_TOMBSTONE_RETENTION_MS
    )
      throw new Error("Stale or out-of-order request for unknown admission run");
    registerAdmissionRun(
      state,
      {
        runId: request.runId,
        studentId: request.studentId,
        submittedAt: createdAt,
        createdAt,
      },
      now,
    );
  }
  if (!state.studentOrder.includes(request.studentId))
    state.studentOrder.push(request.studentId);
  state.pending.push(request);
}

export function admitAvailable(
  state: JudgeAdmissionState,
  now: number,
  allowedSubmissionIds?: ReadonlySet<string>,
): { granted: JudgePermit[]; rejected: JudgeAdmissionState["rejected"] } {
  const granted: JudgePermit[] = [];
  const rejected: JudgeAdmissionState["rejected"] = [];
  const snapshot = state.snapshot;
  if (!snapshot || now - snapshot.observedAt > 90_000 || now < snapshot.observedAt)
    return { granted, rejected };
  const eligible = snapshot.nodes.filter((n) => n.eligible);
  const preparedLimit =
    2 * eligible.reduce((sum, node) => sum + Math.floor(node.budget.cpuMillis / 1000), 0);
  const reservedNodes = new Set<string>();
  const firstRunOf = (studentId: string) =>
    state.runs.find((r) => r.studentId === studentId && !r.finished);
  const students = state.studentOrder
    .map((studentId, index) => {
      const firstRun = firstRunOf(studentId);
      return { studentId, index, priority: firstRun ? runPriority(firstRun) : 0 };
    })
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ studentId }) => studentId);
  for (const studentId of students) {
    if (state.permits.some((p) => p.request.studentId === studentId && !p.cleanupConfirmed))
      continue;
    const firstRun = firstRunOf(studentId);
    const request = state.pending.find((r) => r.runId === firstRun?.runId);
    if (!request || !firstRun) continue;
    if (allowedSubmissionIds && !allowedSubmissionIds.has(firstRun.orderKey)) continue;
    const candidates = snapshot.nodes.filter(
      (n) => !request.nodeName || n.name === request.nodeName,
    );
    if (request.nodeName && candidates.length === 0) {
      const rejection = { request, reason: "artifact_node_unavailable" as const };
      state.rejected.push(rejection);
      rejected.push(rejection);
      state.pending = state.pending.filter((r) => r.requestId !== request.requestId);
      continue;
    }
    const minimum = add(request.resources, request.overhead ?? zero());
    if (
      candidates.length > 0 &&
      candidates.every((n) => !fits(minimum, scale(n.allocatable, 0.75)))
    ) {
      const rejection = { request, reason: "resource_request_unsatisfiable" as const };
      state.rejected.push(rejection);
      rejected.push(rejection);
      state.pending = state.pending.filter((r) => r.requestId !== request.requestId);
      continue;
    }
    if (
      request.phase === "prepare" &&
      state.runs.filter(
        (r) => r.prepared && !r.finished && runPriority(r) <= runPriority(firstRun),
      ).length >= preparedLimit
    )
      continue;
    if (request.phase === "wave" && !firstRun.prepared) continue;
    let waitingForNode: string | undefined;
    for (const node of candidates.filter((n) => n.eligible && !reservedNodes.has(n.name))) {
      const held = state.permits
        .filter((p) => p.nodeName === node.name && !p.cleanupConfirmed)
        .reduce((sum, p) => add(sum, p.resources), zero());
      const available = {
        cpuMillis: node.budget.cpuMillis - held.cpuMillis,
        memoryBytes: node.budget.memoryBytes - held.memoryBytes,
      };
      const overhead = request.overhead ?? zero();
      const units = Math.min(
        1,
        request.maximumUnits,
        Math.floor((available.cpuMillis - overhead.cpuMillis) / request.resources.cpuMillis),
        Math.floor(
          (available.memoryBytes - overhead.memoryBytes) / request.resources.memoryBytes,
        ),
      );
      if (units < 1) {
        if (fits(minimum, node.budget)) waitingForNode ??= node.name;
        continue;
      }
      const permit: JudgePermit = {
        permitId: `${encodeURIComponent(request.runId)}/${encodeURIComponent(request.requestId)}`,
        request,
        nodeName: node.name,
        units,
        resources: add(scale(request.resources, units), overhead),
        cleanupConfirmed: false,
      };
      state.permits.push(permit);
      state.pending = state.pending.filter((r) => r.requestId !== request.requestId);
      if (request.phase === "prepare") firstRun.prepared = true;
      state.studentOrder = [...state.studentOrder.filter((id) => id !== studentId), studentId];
      granted.push(permit);
      waitingForNode = undefined;
      break;
    }
    if (waitingForNode) reservedNodes.add(waitingForNode);
  }
  for (const node of eligible) {
    if (reservedNodes.has(node.name)) continue;
    const held = state.permits
      .filter((p) => p.nodeName === node.name && !p.cleanupConfirmed)
      .reduce((sum, p) => add(sum, p.resources), zero());
    const available = {
      cpuMillis: node.budget.cpuMillis - held.cpuMillis,
      memoryBytes: node.budget.memoryBytes - held.memoryBytes,
    };
    const waves = granted.filter((p) => p.nodeName === node.name && p.request.phase === "wave");
    let expanded: boolean;
    do {
      expanded = false;
      for (const permit of waves) {
        const { resources, maximumUnits } = permit.request;
        if (permit.units >= maximumUnits || !fits(resources, available)) continue;
        permit.units++;
        permit.resources = add(permit.resources, resources);
        available.cpuMillis -= resources.cpuMillis;
        available.memoryBytes -= resources.memoryBytes;
        expanded = true;
      }
    } while (expanded);
  }
  return { granted, rejected };
}

export function confirmPermitCleanup(
  state: JudgeAdmissionState,
  runId: string,
  permitId: string,
  cleanupConfirmed: boolean,
): boolean {
  const permit = state.permits.find(
    (p) => p.permitId === permitId && p.request.runId === runId,
  );
  if (!permit || !cleanupConfirmed) return false;
  permit.cleanupConfirmed = true;
  const run = state.runs.find((r) => r.runId === runId);
  if (run)
    run.lastCompletedSequence = Math.max(
      run.lastCompletedSequence,
      permit.request.sequence ?? 0,
    );
  return true;
}

export function cancelQueuedRun(
  state: JudgeAdmissionState,
  runId: string,
  now = Date.now(),
): void {
  if (!state.cancelledRunIds.includes(runId)) state.cancelledRunIds.push(runId);
  if (!state.closedRuns.some((run) => run.runId === runId))
    state.closedRuns.push({ runId, closedAt: now });
  state.cancelled.push(...state.pending.filter((r) => r.runId === runId));
  state.pending = state.pending.filter((r) => r.runId !== runId);
}

export function finishAdmissionRun(
  state: JudgeAdmissionState,
  runId: string,
  cleanupConfirmed: boolean,
  now = Date.now(),
): boolean {
  const run = state.runs.find((r) => r.runId === runId);
  if (
    !run ||
    !cleanupConfirmed ||
    state.permits.some((p) => p.request.runId === runId && !p.cleanupConfirmed)
  )
    return false;
  cancelQueuedRun(state, runId, now);
  run.finished = true;
  return true;
}

export function compactAdmissionState(state: JudgeAdmissionState, now: number): void {
  for (const run of state.runs.filter((r) => r.finished)) {
    if (!state.closedRuns.some((closed) => closed.runId === run.runId))
      state.closedRuns.push({ runId: run.runId, closedAt: now });
  }
  state.runs = state.runs.filter((run) => !run.finished);
  const activeRuns = new Set(state.runs.map((run) => run.runId));
  state.permits = state.permits.filter((permit) => !permit.cleanupConfirmed);
  state.rejected = state.rejected.filter(({ request }) => activeRuns.has(request.runId));
  state.cancelled = state.cancelled.filter((request) => activeRuns.has(request.runId));
  state.closedRuns = state.closedRuns.filter(
    (run) =>
      activeRuns.has(run.runId) || now - run.closedAt <= ADMISSION_TOMBSTONE_RETENTION_MS,
  );
  const closedRuns = new Set(state.closedRuns.map((run) => run.runId));
  state.cancelledRunIds = state.cancelledRunIds.filter((runId) => closedRuns.has(runId));
  const activeStudents = new Set(state.runs.map((run) => run.studentId));
  state.studentOrder = state.studentOrder.filter((studentId) => activeStudents.has(studentId));
}
