import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { K8sExecutor } from "../../../apps/worker/src/sandbox/kubernetes/executor";

const RUN = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const NAMESPACE = "nojv-sandbox";
const config = {
  namespace: NAMESPACE,
  image: "sandbox:pinned",
  cpuRequest: "100m",
  cpuLimit: "1",
  memoryRequest: "128Mi",
  memoryLimit: "256Mi",
};
const kinds = [
  "Job",
  "Pod",
  "ConfigMap",
  "PersistentVolumeClaim",
  "Service",
  "NetworkPolicy",
] as const;
type Kind = (typeof kinds)[number];
type Resource = { metadata: { name: string; uid?: string; namespace: string } };

function clients() {
  const resources: Record<Kind, Resource[]> = {
    Job: [],
    Pod: [],
    ConfigMap: [],
    PersistentVolumeClaim: [],
    Service: [],
    NetworkPolicy: [],
  };
  const events: string[] = [];
  const sticky = new Set<Kind>();
  const handles: any = { coreApi: {}, batchApi: {}, networkingApi: {}, watch: {} };
  for (const kind of kinds) {
    const api =
      kind === "Job"
        ? handles.batchApi
        : kind === "NetworkPolicy"
          ? handles.networkingApi
          : handles.coreApi;
    api[`listNamespaced${kind}`] = vi.fn(async ({ namespace }) => {
      expect(namespace).toBe(NAMESPACE);
      return { items: resources[kind] };
    });
    api[`deleteNamespaced${kind}`] = vi.fn(
      async ({ namespace, name, body, gracePeriodSeconds }) => {
        expect(namespace).toBe(NAMESPACE);
        expect(gracePeriodSeconds).toBeUndefined();
        const resource = resources[kind].find((entry) => entry.metadata.name === name);
        expect(body.preconditions.uid).toBe(resource?.metadata.uid);
        if (kind === "Job" || kind === "Pod") expect(body.propagationPolicy).toBe("Foreground");
        events.push(`${kind}:${name}`);
        if (!sticky.has(kind))
          resources[kind] = resources[kind].filter((entry) => entry !== resource);
      },
    );
  }
  handles.coreApi.readNamespacedPod = vi.fn(async () => ({ status: { phase: "Running" } }));
  const add = (kind: Kind, suffix: string, runId = RUN) => {
    const resource = {
      metadata: {
        name: `judge-${runId}${suffix}`,
        namespace: NAMESPACE,
        uid: `${kind}-${runId}-${suffix}`,
      },
    };
    resources[kind].push(resource);
    return resource;
  };
  return {
    handles,
    resources,
    events,
    sticky,
    add,
    executor: new K8sExecutor(config, handles),
  };
}

beforeEach(() => {
  vi.stubEnv("HOSTNAME", "worker-current");
  vi.stubEnv("POD_NAMESPACE", "nojv-platform");
});
afterEach(() => vi.unstubAllEnvs());

describe("Kubernetes crashed execution reconciliation", () => {
  it("cleans every exact run resource, preserving other runs and network isolation until all Pods disappear", async () => {
    const fake = clients();
    for (const kind of kinds) {
      fake.add(kind, "-run");
      fake.add(kind, "-run", OTHER);
      fake.add(kind, "-run", `${RUN}evil`);
    }
    expect(await fake.executor.reconcile(RUN, "worker-current")).toBe(true);
    expect(fake.events).toHaveLength(6);
    expect(fake.events.slice(0, 2)).toEqual([`Job:judge-${RUN}-run`, `Pod:judge-${RUN}-run`]);
    expect(fake.events.some((event) => event.includes(OTHER) || event.includes("evil"))).toBe(
      false,
    );
    expect(fake.resources.NetworkPolicy).toHaveLength(2);
    expect(fake.handles.batchApi.deleteNamespacedJob).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ propagationPolicy: "Foreground" }),
      }),
    );
  });

  it("keeps policies, payload and storage while a Pod remains despite accepted deletion", async () => {
    const fake = clients();
    for (const kind of kinds) fake.add(kind, "-run");
    fake.sticky.add("Pod");
    expect(await fake.executor.reconcile(RUN, "worker-current")).toBe(false);
    expect(fake.events).toHaveLength(2);
    expect(fake.resources.ConfigMap).toHaveLength(1);
    expect(fake.resources.PersistentVolumeClaim).toHaveLength(1);
    expect(fake.resources.NetworkPolicy).toHaveLength(1);
  });

  it("cleans a partial payload even when the process crashed before creating a Job", async () => {
    const fake = clients();
    fake.add("ConfigMap", "-w0-p0");
    fake.add("PersistentVolumeClaim", "-runout");
    expect(await fake.executor.reconcile(RUN, "worker-current")).toBe(true);
    expect(fake.events).toHaveLength(2);
  });

  it("does not release cleanup when a support resource remains terminating", async () => {
    const fake = clients();
    fake.add("PersistentVolumeClaim", "-runout");
    fake.sticky.add("PersistentVolumeClaim");
    expect(await fake.executor.reconcile(RUN, "worker-current")).toBe(false);
  });

  it.each(["", "../other", `${RUN}-suffix`])(
    "rejects invalid run IDs without issuing API calls: %s",
    async (runId) => {
      const fake = clients();
      expect(await fake.executor.reconcile(runId, "worker-current")).toBe(false);
      expect(fake.handles.batchApi.listNamespacedJob).not.toHaveBeenCalled();
    },
  );

  it("refuses cleanup without recorded ownership or immutable resource identity", async () => {
    const fake = clients();
    expect(await fake.executor.reconcile(RUN)).toBe(false);
    const resource: Resource = fake.add("Job", "");
    delete resource.metadata.uid;
    expect(await fake.executor.reconcile(RUN, "worker-current")).toBe(false);
    expect(fake.events).toHaveLength(0);
  });

  it("refuses to clean another worker's execution while that Pod is live", async () => {
    const fake = clients();
    fake.add("Job", "");
    expect(await fake.executor.reconcile(RUN, "worker-old")).toBe(false);
    expect(fake.handles.coreApi.readNamespacedPod).toHaveBeenCalledWith({
      namespace: "nojv-platform",
      name: "worker-old",
    });
    expect(fake.events).toHaveLength(0);
  });

  it.each(["Failed", "Succeeded", "missing"])(
    "can reconcile an old worker that is %s",
    async (phase) => {
      const fake = clients();
      fake.add("Job", "");
      if (phase === "missing")
        fake.handles.coreApi.readNamespacedPod.mockRejectedValue({ code: 404 });
      else fake.handles.coreApi.readNamespacedPod.mockResolvedValue({ status: { phase } });
      expect(await fake.executor.reconcile(RUN, "worker-old")).toBe(true);
    },
  );

  it("fails closed on uncertain worker or resource API responses", async () => {
    const fake = clients();
    fake.add("Job", "");
    fake.handles.coreApi.readNamespacedPod.mockRejectedValue({ code: 503 });
    expect(await fake.executor.reconcile(RUN, "worker-old")).toBe(false);
    fake.handles.coreApi.listNamespacedConfigMap.mockRejectedValue({ code: 403 });
    expect(await fake.executor.reconcile(RUN, "worker-current")).toBe(false);
    expect(fake.events).toHaveLength(0);
  });
});
