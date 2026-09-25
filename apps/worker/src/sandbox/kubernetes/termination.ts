import type * as k8s from "@kubernetes/client-node";

import { failureMessage, retryK8sCleanupCall } from "./cleanup-call";

export class SandboxCleanupPendingError extends Error {
  constructor(
    readonly resources: string[],
    cause?: unknown,
  ) {
    super(
      `cleanup_pending: ${resources.join(", ")}${cause === undefined ? "" : `: ${failureMessage(cause)}`}`,
      { cause },
    );
    this.name = "SandboxCleanupPendingError";
  }
}

export function isK8sNotFound(error: unknown): boolean {
  if (error instanceof Error && error.cause !== undefined) return isK8sNotFound(error.cause);
  if (typeof error !== "object" || error === null) return false;
  const value = error as {
    code?: number;
    statusCode?: number;
    response?: { statusCode?: number };
  };
  return value.code === 404 || value.statusCode === 404 || value.response?.statusCode === 404;
}

export class SandboxCleanupBudget {
  private readonly deadline: number;

  constructor(timeoutMs = 30_000) {
    this.deadline = Date.now() + timeoutMs;
  }

  async call<T>(resource: string, operation: () => Promise<T>): Promise<T> {
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) throw new SandboxCleanupPendingError([resource]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        retryK8sCleanupCall(resource, () => {
          if (Date.now() >= this.deadline) throw new SandboxCleanupPendingError([resource]);
          return operation();
        }) as Promise<T>,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new SandboxCleanupPendingError([resource])),
            remaining,
          );
        }),
      ]);
    } catch (error) {
      if (error instanceof SandboxCleanupPendingError) throw error;
      throw new SandboxCleanupPendingError([resource], error);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async pause(resource: string, pollMs: number): Promise<void> {
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) throw new SandboxCleanupPendingError([resource]);
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
  }
}

interface TerminationOptions {
  timeoutMs?: number;
  pollMs?: number;
  budget?: SandboxCleanupBudget;
}

export async function terminateSandboxJob(
  core: k8s.CoreV1Api,
  batch: k8s.BatchV1Api,
  namespace: string,
  name: string,
  options: TerminationOptions = {},
): Promise<void> {
  const resource = `Job ${namespace}/${name}`;
  const budget = options.budget ?? new SandboxCleanupBudget(options.timeoutMs);
  const call = <T>(operation: () => Promise<T>) => budget.call(resource, operation);
  let job: k8s.V1Job | undefined;
  try {
    job = await call(() => batch.readNamespacedJob({ namespace, name }));
  } catch (error) {
    if (!isK8sNotFound(error)) throw error;
  }
  const before = await call(() =>
    core.listNamespacedPod({ namespace, labelSelector: `job-name=${name}` }),
  );
  const owned = new Set(
    before.items
      .map((pod) => pod.metadata?.uid)
      .filter((uid): uid is string => typeof uid === "string"),
  );
  const jobUid = job?.metadata?.uid;
  if (job) {
    if (!jobUid) throw new SandboxCleanupPendingError([`${resource} has no UID`]);
    if (
      before.items.some(
        (pod) =>
          !pod.metadata?.uid ||
          !pod.metadata.ownerReferences?.some((owner) => owner.uid === jobUid),
      )
    )
      throw new SandboxCleanupPendingError([`${resource} Pod ownership mismatch`]);
    try {
      await call(() =>
        batch.deleteNamespacedJob({
          namespace,
          name,
          body: { propagationPolicy: "Foreground", preconditions: { uid: jobUid } },
        }),
      );
    } catch (error) {
      if (!isK8sNotFound(error)) throw error;
    }
  }
  for (;;) {
    const pods = await call(() =>
      core.listNamespacedPod({ namespace, labelSelector: `job-name=${name}` }),
    );
    if (pods.items.length === 0) return;
    for (const pod of pods.items) {
      const uid = pod.metadata?.uid;
      if (
        !uid ||
        (!owned.has(uid) &&
          !(jobUid && pod.metadata?.ownerReferences?.some((owner) => owner.uid === jobUid)))
      )
        throw new SandboxCleanupPendingError([
          `Pod ${pod.metadata?.name ?? name} ownership changed`,
        ]);
    }
    await budget.pause(resource, options.pollMs ?? 500);
  }
}

export async function terminateSandboxPod(
  core: k8s.CoreV1Api,
  namespace: string,
  name: string,
  options: TerminationOptions & { expectedUid?: string } = {},
): Promise<void> {
  const resource = `Pod ${namespace}/${name}`;
  const budget = options.budget ?? new SandboxCleanupBudget(options.timeoutMs);
  const list = () =>
    budget.call(resource, () =>
      core.listNamespacedPod({ namespace, fieldSelector: `metadata.name=${name}` }),
    );
  const before = await list();
  if (before.items.length === 0) return;
  const uid = before.items[0]?.metadata?.uid;
  if (!uid || before.items.length !== 1 || (options.expectedUid && uid !== options.expectedUid))
    throw new SandboxCleanupPendingError([`${resource} ownership changed`]);
  try {
    await budget.call(resource, () =>
      core.deleteNamespacedPod({
        namespace,
        name,
        body: { propagationPolicy: "Foreground", preconditions: { uid } },
      }),
    );
  } catch (error) {
    if (!isK8sNotFound(error)) throw error;
  }
  for (;;) {
    const pods = await list();
    if (pods.items.length === 0) return;
    if (pods.items.some((pod) => pod.metadata?.uid !== uid))
      throw new SandboxCleanupPendingError([`${resource} ownership changed`]);
    await budget.pause(resource, options.pollMs ?? 500);
  }
}
