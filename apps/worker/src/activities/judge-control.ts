import { judgeQuota } from "../services/judge-quota";
import { CoreV1Api, KubeConfig, NodeV1Api } from "@kubernetes/client-node";
import { metrics } from "@opentelemetry/api";
import {
  buildCapacitySnapshot,
  parseResourceQuantity,
  type JudgePermit,
} from "../services/judge-capacity";
import { isK8sNotFound } from "../services/k8s-termination";
import { createLogger } from "../logger";

const logger = createLogger("judge-control");
const meter = metrics.getMeter("nojv-judge");
const quarantined = meter.createGauge("judge_quarantined_nodes");
const queued = meter.createGauge("judge_queued_requests");
const permits = meter.createGauge("judge_active_permits");

export async function refreshJudgeCapacity(
  quarantinedNodes: string[],
  held: JudgePermit[],
  manageQuota: boolean,
  pendingCount: number,
) {
  const namespace = process.env.K8S_NAMESPACE;
  if (!namespace) throw new Error("K8S_NAMESPACE is required");
  const config = new KubeConfig();
  config.loadFromCluster();
  const core = config.makeApiClient(CoreV1Api);
  const [nodes, allPods, events, runtime] = await Promise.all([
    core.listNode({ labelSelector: "nojv-role=sandbox" }),
    core.listPodForAllNamespaces(),
    core.listNamespacedEvent({ namespace, fieldSelector: "reason=FailedKillPod" }),
    config.makeApiClient(NodeV1Api).readRuntimeClass({ name: "gvisor" }),
  ]);
  const quarantine = new Set(quarantinedNodes);
  for (const event of events.items) {
    if ((event.count ?? 1) < 3) continue;
    const pod = allPods.items.find((p) => p.metadata?.uid === event.involvedObject.uid);
    const node = pod?.spec?.nodeName ?? event.source?.host;
    if (node) {
      quarantine.add(node);
      logger.error("Judge node quarantined after repeated FailedKillPod", {
        nodeName: node,
        podUid: event.involvedObject.uid,
      });
    }
  }
  const pods = allPods.items.map((pod) => {
    const tracked = held.some(
      (permit) =>
        pod.metadata?.name?.startsWith(`judge-${permit.request.runId}-`) === true ||
        pod.metadata?.name === `judge-${permit.request.runId}`,
    );
    if (pod.metadata?.namespace === namespace && !tracked)
      pod.metadata.namespace = "unmanaged-sandbox";
    return pod;
  });
  const capacity = buildCapacitySnapshot(
    nodes.items,
    pods,
    [...quarantine],
    Date.now(),
    namespace,
  );
  if (manageQuota) {
    const budget = judgeQuota(capacity, held);
    const cpu = budget.cpuMillis;
    const memory = budget.memoryBytes;
    const name = "sandbox-quota";
    let quota;
    try {
      quota = await core.readNamespacedResourceQuota({ namespace, name });
    } catch (error) {
      if (!isK8sNotFound(error)) throw error;
    }
    const body = {
      apiVersion: "v1",
      kind: "ResourceQuota",
      metadata: {
        name,
        namespace,
        ...(quota?.metadata?.resourceVersion
          ? { resourceVersion: quota.metadata.resourceVersion }
          : {}),
      },
      spec: {
        hard: {
          "requests.cpu": `${String(cpu)}m`,
          "requests.memory": String(memory),
          pods: String(budget.pods),
        },
      },
    };
    if (quota) await core.replaceNamespacedResourceQuota({ namespace, name, body });
    else await core.createNamespacedResourceQuota({ namespace, body });
  }
  queued.record(pendingCount, { phase: "admission", result: "waiting" });
  quarantined.record(quarantine.size, { phase: "admission", result: "failure" });
  permits.record(held.length, { phase: "admission", result: "success" });
  return {
    capacity,
    quotaManaged: manageQuota,
    quarantinedNodes: [...quarantine],
    overhead: {
      cpuMillis: parseResourceQuantity(runtime.overhead?.podFixed?.cpu, true),
      memoryBytes: parseResourceQuantity(runtime.overhead?.podFixed?.memory),
    },
  };
}
