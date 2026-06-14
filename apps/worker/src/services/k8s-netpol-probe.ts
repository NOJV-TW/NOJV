import { createRequire } from "node:module";

import type * as k8s from "@kubernetes/client-node";

import { createLogger } from "../logger.js";

const require = createRequire(import.meta.url);

const logger = createLogger("k8s-netpol-probe");

export const NETPOL_PROBE_IMAGE = "busybox:latest";
export const PROBE_REACHED_MARKER = "REACHED";
export const PROBE_BLOCKED_MARKER = "BLOCKED";

const PROBE_TARGET = "https://1.1.1.1";
const PROBE_CONNECT_TIMEOUT_SECONDS = 4;
const PROBE_ACTIVE_DEADLINE_SECONDS = 30;
const PROBE_POLL_INTERVAL_MS = 1_000;
const PROBE_WAIT_TIMEOUT_MS = 60_000;

export type ProbeOutcome = "reached" | "blocked" | "unconfirmed";

export interface NetpolGateDecision {
  enforced: boolean;
  action: "ok" | "warn-proceed" | "refuse";
}

export function decideNetworkPolicyGate(params: {
  outcome: ProbeOutcome;
  allowUnenforced: boolean;
}): NetpolGateDecision {
  if (params.outcome === "blocked") return { enforced: true, action: "ok" };
  return { enforced: false, action: params.allowUnenforced ? "warn-proceed" : "refuse" };
}

export function netpolProbePodName(): string {
  return "nojv-netpol-probe";
}

export interface NetpolProbePodParams {
  namespace: string;
  image: string;
  podName: string;
}

export function buildNetpolProbePodManifest(params: NetpolProbePodParams): k8s.V1Pod {
  const command = [
    "sh",
    "-c",
    `wget -T ${String(PROBE_CONNECT_TIMEOUT_SECONDS)} -q -O- ${PROBE_TARGET} >/dev/null 2>&1 ` +
      `&& echo ${PROBE_REACHED_MARKER} || echo ${PROBE_BLOCKED_MARKER}`,
  ];
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: params.podName,
      namespace: params.namespace,
      labels: { app: "nojv-sandbox", "nojv-role": "sandbox" },
    },
    spec: {
      restartPolicy: "Never",
      activeDeadlineSeconds: PROBE_ACTIVE_DEADLINE_SECONDS,
      automountServiceAccountToken: false,
      nodeSelector: { "nojv-role": "sandbox" },
      tolerations: [
        { key: "nojv-role", operator: "Equal", value: "sandbox", effect: "NoSchedule" },
      ],
      securityContext: {
        runAsUser: 10001,
        runAsGroup: 10001,
        runAsNonRoot: true,
        seccompProfile: { type: "RuntimeDefault" },
      },
      containers: [
        {
          name: "probe",
          image: params.image,
          command,
          resources: {
            requests: { cpu: "100m", memory: "64Mi" },
            limits: { cpu: "100m", memory: "64Mi" },
          },
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ["ALL"] },
            readOnlyRootFilesystem: true,
            runAsNonRoot: true,
          },
        },
      ],
    },
  };
}

function parseProbeLog(log: string): "reached" | "blocked" | null {
  if (log.includes(PROBE_REACHED_MARKER)) return "reached";
  if (log.includes(PROBE_BLOCKED_MARKER)) return "blocked";
  return null;
}

const REACHED_REMEDIATION =
  "Cluster does NOT enforce NetworkPolicy: sandbox egress isolation is INERT and student " +
  "code can reach the internet. Enable a NetworkPolicy-enforcing CNI before judging — GKE " +
  "Dataplane V2 (or `--enable-network-policy`), or install Calico/Cilium. For k3s start with " +
  "`--flannel-backend=none --disable-network-policy` then install Calico/Cilium.";

const UNCONFIRMED_REMEDIATION =
  "Could NOT confirm NetworkPolicy enforcement: the probe Pod never reported a clean BLOCKED " +
  "(it may be stuck Pending / ImagePullBackOff / blocked by ResourceQuota, killed before " +
  "emitting a marker, or the API read failed). Enforcement is UNVERIFIED, so this is treated " +
  "as NOT enforced. Check the sandbox namespace can schedule a busybox Pod (quota, node " +
  "selector/taint, image pull), then re-roll; only a positively-observed BLOCKED is accepted.";

export interface NetworkPolicyProbeDeps {
  createPod: (namespace: string, body: k8s.V1Pod) => Promise<void>;
  readPodLog: (name: string, namespace: string) => Promise<string>;
  readPodPhase: (name: string, namespace: string) => Promise<string | undefined>;
  deletePod: (name: string, namespace: string) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

async function runProbe(
  namespace: string,
  image: string,
  deps: NetworkPolicyProbeDeps,
): Promise<ProbeOutcome> {
  const podName = netpolProbePodName();
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  await deps.deletePod(podName, namespace).catch(() => undefined);
  try {
    await deps.createPod(namespace, buildNetpolProbePodManifest({ namespace, image, podName }));

    try {
      const deadline = now() + PROBE_WAIT_TIMEOUT_MS;
      while (now() < deadline) {
        const phase = await deps.readPodPhase(podName, namespace);
        if (phase === "Succeeded" || phase === "Failed") {
          const log = await deps.readPodLog(podName, namespace);
          return parseProbeLog(log) ?? "unconfirmed";
        }
        await sleep(PROBE_POLL_INTERVAL_MS);
      }
    } catch (err) {
      logger.warn("NetworkPolicy probe read failed — enforcement is UNCONFIRMED", {
        namespace,
        err: err instanceof Error ? err.message : String(err),
      });
      return "unconfirmed";
    }
    return "unconfirmed";
  } finally {
    await deps.deletePod(podName, namespace).catch(() => undefined);
  }
}

export interface VerifyNetworkPolicyParams {
  namespace: string;
  allowUnenforced: boolean;
  image?: string;
  deps?: NetworkPolicyProbeDeps;
}

export async function verifyNetworkPolicyEnforced(
  params: VerifyNetworkPolicyParams,
): Promise<NetpolGateDecision> {
  const image = params.image ?? NETPOL_PROBE_IMAGE;
  const deps = params.deps ?? createDefaultProbeDeps();

  const outcome = await runProbe(params.namespace, image, deps);
  const decision = decideNetworkPolicyGate({
    outcome,
    allowUnenforced: params.allowUnenforced,
  });

  const remediation = outcome === "reached" ? REACHED_REMEDIATION : UNCONFIRMED_REMEDIATION;
  const reason =
    outcome === "reached"
      ? "sandbox egress REACHED the internet"
      : "could not confirm enforcement (probe never reported a clean BLOCKED)";

  if (decision.action === "ok") {
    logger.info("NetworkPolicy enforcement verified — sandbox egress is isolated", {
      namespace: params.namespace,
    });
  } else if (decision.action === "warn-proceed") {
    logger.warn(
      `NetworkPolicy enforcement not verified (${reason}) but NOJV_ALLOW_UNENFORCED_NETWORK_POLICY is set — proceeding (DEV ONLY)`,
      { namespace: params.namespace, outcome, remediation },
    );
  } else {
    logger.error(
      `CRITICAL: refusing to start K8s judge worker — NetworkPolicy enforcement not verified (${reason})`,
      { namespace: params.namespace, outcome, remediation },
    );
  }

  return decision;
}

function createDefaultProbeDeps(): NetworkPolicyProbeDeps {
  const k8sLib = require("@kubernetes/client-node") as typeof k8s;
  const kc = new k8sLib.KubeConfig();
  kc.loadFromCluster();
  const coreApi = kc.makeApiClient(k8sLib.CoreV1Api);

  return {
    createPod: async (namespace, body) => {
      await coreApi.createNamespacedPod({ namespace, body });
    },
    readPodLog: (name, namespace) => coreApi.readNamespacedPodLog({ name, namespace }),
    readPodPhase: async (name, namespace) => {
      const pod = await coreApi.readNamespacedPod({ name, namespace });
      return pod.status?.phase;
    },
    deletePod: async (name, namespace) => {
      await coreApi.deleteNamespacedPod({
        name,
        namespace,
        propagationPolicy: "Background",
      });
    },
  };
}
