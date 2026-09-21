import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { CoreV1Api, KubeConfig } from "@kubernetes/client-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { refreshJudgeCapacity } from "../../../apps/worker/src/activities/judge-control";
import { judgeQuota } from "../../../apps/worker/src/services/judge-quota";
import { assertSafeK8sIntegrationTarget } from "../../setup/k8s-integration-target";

describe("real capacity control API and chart RBAC", () => {
  const config = new KubeConfig();
  let namespace: string;
  let core: CoreV1Api;
  let manifest: string;
  const release = `capacity-${randomUUID().slice(0, 8)}`;
  const eventName = `${release}-failed-kill`;
  let eventCreated = false;
  let quotaCreated = false;

  beforeAll(async () => {
    config.loadFromDefault();
    namespace = assertSafeK8sIntegrationTarget({
      env: process.env,
      context: config.getCurrentContext(),
      server: config.getCurrentCluster()?.server ?? "",
    }).namespace;
    core = config.makeApiClient(CoreV1Api);
    const existing = await core.listNamespacedResourceQuota({ namespace });
    if (existing.items.some((item) => item.metadata?.name === "sandbox-quota"))
      throw new Error("Control test requires its disposable namespace without sandbox-quota");
    manifest = execFileSync(
      "helm",
      [
        "template",
        release,
        "infra/charts/nojv",
        "-f",
        "tests/fixtures/helm/immutable-image-digests.yaml",
        "--set",
        `namespace=${namespace}`,
        "--set",
        `sandboxNamespace=${namespace}`,
        "--set",
        "worker.sandbox.capacityAdmission.enabled=true",
        "--show-only",
        "templates/worker-rbac.yaml",
      ],
      { encoding: "utf8" },
    );
    execFileSync("kubectl", ["--context", config.getCurrentContext(), "apply", "-f", "-"], {
      input: manifest,
      stdio: ["pipe", "ignore", "pipe"],
    });
    const issued = await core.createNamespacedServiceAccountToken({
      namespace,
      name: `${release}-nojv-worker-judge`,
      body: { spec: { expirationSeconds: 600, audiences: [] } },
    });
    if (!issued.status?.token) throw new Error("Service account token was not issued");
    const token = issued.status.token;
    const cluster = config.getCurrentCluster();
    if (!cluster) throw new Error("Test cluster configuration is missing");
    vi.spyOn(KubeConfig.prototype, "loadFromCluster").mockImplementation(function (
      this: KubeConfig,
    ) {
      this.loadFromOptions({
        clusters: config.clusters,
        users: [{ name: "controller", token }],
        contexts: [
          {
            name: "controller",
            cluster: cluster.name,
            user: "controller",
          },
        ],
        currentContext: "controller",
      });
    });
    vi.stubEnv("K8S_NAMESPACE", namespace);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    if (eventCreated) await core.deleteNamespacedEvent({ namespace, name: eventName });
    if (quotaCreated)
      await core.deleteNamespacedResourceQuota({ namespace, name: "sandbox-quota" });
    if (manifest)
      execFileSync(
        "kubectl",
        ["--context", config.getCurrentContext(), "delete", "-f", "-", "--ignore-not-found"],
        {
          input: manifest,
          stdio: ["pipe", "ignore", "pipe"],
        },
      );
  });

  it("creates and replaces quota with chart permissions, quarantines repeated failures, and retains quarantine", async () => {
    const observed = await refreshJudgeCapacity([], [], false, 0);
    const eligible = observed.capacity.nodes.filter((node) => node.eligible);
    expect(eligible.length).toBeGreaterThanOrEqual(2);
    expect((await core.listNamespacedResourceQuota({ namespace })).items).toEqual([]);

    quotaCreated = true;
    const first = await refreshJudgeCapacity([], [], true, 2);
    const quota = await core.readNamespacedResourceQuota({ namespace, name: "sandbox-quota" });
    expect(quota.spec?.hard?.["requests.cpu"]).toBe(
      `${judgeQuota(first.capacity, []).cpuMillis}m`,
    );
    expect(quota.metadata?.resourceVersion).toBeTruthy();

    const failed = eligible[0]?.name;
    if (!failed) throw new Error("No sandbox node available");
    await core.createNamespacedEvent({
      namespace,
      body: {
        metadata: { name: eventName },
        reason: "FailedKillPod",
        message: "Dedicated test event: repeated sandbox termination failure",
        type: "Warning",
        count: 3,
        source: { component: "kubelet", host: failed },
        involvedObject: {
          apiVersion: "v1",
          kind: "Pod",
          namespace,
          name: eventName,
          uid: randomUUID(),
        },
      },
    });
    eventCreated = true;
    const quarantined = await refreshJudgeCapacity([], [], true, 2);
    expect(quarantined.quarantinedNodes).toContain(failed);
    expect(quarantined.capacity.nodes.find((node) => node.name === failed)?.eligible).toBe(
      false,
    );
    expect(
      quarantined.capacity.nodes.some((node) => node.name !== failed && node.eligible),
    ).toBe(true);
    const updated = await core.readNamespacedResourceQuota({
      namespace,
      name: "sandbox-quota",
    });
    expect(updated.spec?.hard?.["requests.cpu"]).toBe(
      `${judgeQuota(quarantined.capacity, []).cpuMillis}m`,
    );
    expect(updated.metadata?.resourceVersion).not.toBe(quota.metadata?.resourceVersion);
    await core.deleteNamespacedEvent({ namespace, name: eventName });
    eventCreated = false;
    const retained = await refreshJudgeCapacity(quarantined.quarantinedNodes, [], true, 0);
    expect(retained.quarantinedNodes).toContain(failed);
  });
});
