import { createRequire } from "node:module";

import type * as k8s from "@kubernetes/client-node";

import { createLogger } from "../logger.js";
import {
  HARDENED_CONTAINER_SECURITY_CONTEXT,
  runtimeClassField,
  SANDBOX_NODE_SELECTOR,
  SANDBOX_POD_SECURITY_CONTEXT,
  SANDBOX_TOLERATIONS,
} from "./k8s-pod-spec";

const require = createRequire(import.meta.url);

const logger = createLogger("k8s-netpol-probe");

export const NETPOL_PROBE_IMAGE =
  "busybox:latest@sha256:fd8d9aa63ba2f0982b5304e1ee8d3b90a210bc1ffb5314d980eb6962f1a9715d";
export const PROBE_ALLOWED_REACHED_MARKER = "ALLOWED_REACHED";
export const PROBE_ALLOWED_BLOCKED_MARKER = "ALLOWED_BLOCKED";
export const PROBE_DENIED_REACHED_MARKER = "DENIED_REACHED";
export const PROBE_DENIED_BLOCKED_MARKER = "DENIED_BLOCKED";

const PROBE_TARGET_PORT = 8080;
const PROBE_TARGET_LABEL = "nojv-netpol-probe-target";
const PROBE_SOURCE_LABEL = "nojv-netpol-probe-source";
const PROBE_ALLOWED_TARGET = "allowed";
const PROBE_DENIED_TARGET = "denied";
const PROBE_ALLOWED_TARGET_POD_NAME = "nojv-netpol-probe-target-allowed";
const PROBE_DENIED_TARGET_POD_NAME = "nojv-netpol-probe-target-denied";
const PROBE_ALLOW_INGRESS_POLICY_NAME = "nojv-netpol-probe-allow-ingress";
const PROBE_ALLOW_EGRESS_POLICY_NAME = "nojv-netpol-probe-allow-egress";
const PROBE_URL_PREFIX = "http" + "://";
const PROBE_CONNECT_TIMEOUT_SECONDS = 4;
const PROBE_ACTIVE_DEADLINE_SECONDS = 30;
const PROBE_POLL_INTERVAL_MS = 1_000;
const PROBE_WAIT_TIMEOUT_MS = 60_000;

export type ProbeOutcome = "reached" | "blocked" | "unconfirmed";

export interface NetpolGateDecision {
  enforced: boolean;
  action: "ok" | "refuse";
}

export function decideNetworkPolicyGate(params: { outcome: ProbeOutcome }): NetpolGateDecision {
  if (params.outcome === "blocked") return { enforced: true, action: "ok" };
  return { enforced: false, action: "refuse" };
}

export function netpolProbePodName(): string {
  return "nojv-netpol-probe";
}

export type NetpolProbeTarget = "allowed" | "denied";

export interface NetpolProbePodParams {
  namespace: string;
  image: string;
  podName: string;
  allowedTargetIp: string;
  deniedTargetIp: string;
  runtimeClassName?: string;
  imagePullSecretName?: string;
}

export interface NetpolProbeTargetPodParams {
  namespace: string;
  image: string;
  podName: string;
  target: NetpolProbeTarget;
  runtimeClassName?: string;
  imagePullSecretName?: string;
}

function buildProbePodBase(params: {
  namespace: string;
  image: string;
  podName: string;
  runtimeClassName?: string;
  imagePullSecretName?: string;
}): Omit<k8s.V1PodSpec, "containers"> {
  return {
    restartPolicy: "Never",
    activeDeadlineSeconds: PROBE_ACTIVE_DEADLINE_SECONDS,
    automountServiceAccountToken: false,
    ...runtimeClassField(params.runtimeClassName),
    ...(params.imagePullSecretName
      ? { imagePullSecrets: [{ name: params.imagePullSecretName }] }
      : {}),
    nodeSelector: SANDBOX_NODE_SELECTOR,
    tolerations: SANDBOX_TOLERATIONS,
    securityContext: SANDBOX_POD_SECURITY_CONTEXT,
  };
}

export function buildNetpolProbePodManifest(params: NetpolProbePodParams): k8s.V1Pod {
  const command = [
    "sh",
    "-c",
    `if wget -T ${String(PROBE_CONNECT_TIMEOUT_SECONDS)} -q -O- ${PROBE_URL_PREFIX}${params.allowedTargetIp}:${String(PROBE_TARGET_PORT)} >/dev/null 2>&1; ` +
      `then echo ${PROBE_ALLOWED_REACHED_MARKER}; else echo ${PROBE_ALLOWED_BLOCKED_MARKER}; fi; ` +
      `if wget -T ${String(PROBE_CONNECT_TIMEOUT_SECONDS)} -q -O- ${PROBE_URL_PREFIX}${params.deniedTargetIp}:${String(PROBE_TARGET_PORT)} >/dev/null 2>&1; ` +
      `then echo ${PROBE_DENIED_REACHED_MARKER}; else echo ${PROBE_DENIED_BLOCKED_MARKER}; fi`,
  ];
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: params.podName,
      namespace: params.namespace,
      labels: {
        app: "nojv-sandbox",
        "nojv-role": "sandbox",
        [PROBE_SOURCE_LABEL]: "true",
      },
    },
    spec: {
      ...buildProbePodBase(params),
      containers: [
        {
          name: "probe",
          image: params.image,
          command,
          resources: {
            requests: { cpu: "100m", memory: "64Mi" },
            limits: { cpu: "100m", memory: "64Mi" },
          },
          securityContext: HARDENED_CONTAINER_SECURITY_CONTEXT,
        },
      ],
    },
  };
}

export function buildNetpolProbeTargetPodManifest(
  params: NetpolProbeTargetPodParams,
): k8s.V1Pod {
  const target = params.target === "allowed" ? PROBE_ALLOWED_TARGET : PROBE_DENIED_TARGET;
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: params.podName,
      namespace: params.namespace,
      labels: {
        app: "nojv-sandbox",
        "nojv-role": "sandbox",
        [PROBE_TARGET_LABEL]: "true",
        [`${PROBE_TARGET_LABEL}-kind`]: target,
      },
    },
    spec: {
      ...buildProbePodBase(params),
      containers: [
        {
          name: "target",
          image: params.image,
          command: [
            "sh",
            "-c",
            `while true; do printf 'HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\n\\r\\nOK' | nc -l -p ${String(PROBE_TARGET_PORT)}; done`,
          ],
          readinessProbe: {
            tcpSocket: { port: PROBE_TARGET_PORT },
            periodSeconds: 1,
            timeoutSeconds: 1,
            failureThreshold: 30,
          },
          resources: {
            requests: { cpu: "100m", memory: "64Mi" },
            limits: { cpu: "100m", memory: "64Mi" },
          },
          securityContext: HARDENED_CONTAINER_SECURITY_CONTEXT,
        },
      ],
    },
  };
}

export function buildNetpolProbeIngressPolicy(namespace: string): k8s.V1NetworkPolicy {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: PROBE_ALLOW_INGRESS_POLICY_NAME, namespace },
    spec: {
      podSelector: { matchLabels: { [PROBE_TARGET_LABEL]: "true" } },
      policyTypes: ["Ingress"],
      ingress: [
        {
          _from: [{ podSelector: { matchLabels: { [PROBE_SOURCE_LABEL]: "true" } } }],
          ports: [{ protocol: "TCP", port: PROBE_TARGET_PORT }],
        },
      ],
    },
  };
}

export function buildNetpolProbeEgressPolicy(namespace: string): k8s.V1NetworkPolicy {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: PROBE_ALLOW_EGRESS_POLICY_NAME, namespace },
    spec: {
      podSelector: { matchLabels: { [PROBE_SOURCE_LABEL]: "true" } },
      policyTypes: ["Egress"],
      egress: [
        {
          to: [
            {
              podSelector: {
                matchLabels: {
                  [PROBE_TARGET_LABEL]: "true",
                  [`${PROBE_TARGET_LABEL}-kind`]: PROBE_ALLOWED_TARGET,
                },
              },
            },
          ],
          ports: [{ protocol: "TCP", port: PROBE_TARGET_PORT }],
        },
      ],
    },
  };
}

function parseProbeLog(log: string): ProbeOutcome | null {
  if (log.includes(PROBE_DENIED_REACHED_MARKER)) return "reached";
  if (log.includes(PROBE_ALLOWED_REACHED_MARKER) && log.includes(PROBE_DENIED_BLOCKED_MARKER)) {
    return "blocked";
  }
  return null;
}

const REACHED_REMEDIATION =
  "Cluster CNI did NOT enforce sandbox egress NetworkPolicy: an internal target without " +
  "an egress allow rule was reachable. NetworkPolicy enforcement is INERT, so refusing to " +
  "judge. Enable a NetworkPolicy-enforcing CNI before judging — GKE Dataplane V2 (or " +
  "`--enable-network-policy`), or install Calico/Cilium. For k3s start with " +
  "`--flannel-backend=none --disable-network-policy` then install Calico/Cilium.";

const UNCONFIRMED_REMEDIATION =
  "Could NOT confirm NetworkPolicy enforcement: the internal probe did not report the " +
  "expected ALLOWED_REACHED and DENIED_BLOCKED pair (it may be stuck Pending / " +
  "ImagePullBackOff / blocked by ResourceQuota, killed before emitting a marker, or the API " +
  "read failed). Enforcement is UNVERIFIED, so this is treated as NOT enforced. Check the " +
  "sandbox namespace can schedule the probe Pods and NetworkPolicies, then re-roll.";

export interface NetworkPolicyProbeDeps {
  createPod: (namespace: string, body: k8s.V1Pod) => Promise<void>;
  readPod: (name: string, namespace: string) => Promise<k8s.V1Pod>;
  readPodLog: (name: string, namespace: string) => Promise<string>;
  readPodPhase: (name: string, namespace: string) => Promise<string | undefined>;
  deletePod: (name: string, namespace: string) => Promise<void>;
  createNetworkPolicy: (namespace: string, body: k8s.V1NetworkPolicy) => Promise<void>;
  deleteNetworkPolicy: (name: string, namespace: string) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

async function deleteProbeResources(
  namespace: string,
  deps: NetworkPolicyProbeDeps,
): Promise<void> {
  for (const name of [PROBE_ALLOW_EGRESS_POLICY_NAME, PROBE_ALLOW_INGRESS_POLICY_NAME]) {
    await deps.deleteNetworkPolicy(name, namespace).catch(() => undefined);
  }
  for (const name of [
    netpolProbePodName(),
    PROBE_ALLOWED_TARGET_POD_NAME,
    PROBE_DENIED_TARGET_POD_NAME,
  ]) {
    await deps.deletePod(name, namespace).catch(() => undefined);
  }
}

async function readReadyTargetIp(
  name: string,
  namespace: string,
  deps: NetworkPolicyProbeDeps,
): Promise<string | undefined> {
  const pod = await deps.readPod(name, namespace);
  if (pod.status?.phase !== "Running" || !pod.status.podIP) return undefined;
  if (!pod.status.containerStatuses?.some((status) => status.ready)) return undefined;
  return pod.status.podIP;
}

async function runProbe(
  namespace: string,
  image: string,
  runtimeClassName: string | undefined,
  imagePullSecretName: string | undefined,
  deps: NetworkPolicyProbeDeps,
): Promise<ProbeOutcome> {
  const podName = netpolProbePodName();
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  await deleteProbeResources(namespace, deps);
  try {
    await deps.createPod(
      namespace,
      buildNetpolProbeTargetPodManifest({
        namespace,
        image,
        podName: PROBE_ALLOWED_TARGET_POD_NAME,
        target: "allowed",
        ...(runtimeClassName ? { runtimeClassName } : {}),
        ...(imagePullSecretName ? { imagePullSecretName } : {}),
      }),
    );
    await deps.createPod(
      namespace,
      buildNetpolProbeTargetPodManifest({
        namespace,
        image,
        podName: PROBE_DENIED_TARGET_POD_NAME,
        target: "denied",
        ...(runtimeClassName ? { runtimeClassName } : {}),
        ...(imagePullSecretName ? { imagePullSecretName } : {}),
      }),
    );

    const deadline = now() + PROBE_WAIT_TIMEOUT_MS;
    let allowedTargetIp: string | undefined;
    let deniedTargetIp: string | undefined;
    try {
      while (now() < deadline) {
        [allowedTargetIp, deniedTargetIp] = await Promise.all([
          readReadyTargetIp(PROBE_ALLOWED_TARGET_POD_NAME, namespace, deps),
          readReadyTargetIp(PROBE_DENIED_TARGET_POD_NAME, namespace, deps),
        ]);
        if (allowedTargetIp && deniedTargetIp) break;
        await sleep(PROBE_POLL_INTERVAL_MS);
      }
    } catch (err) {
      logger.warn("NetworkPolicy probe target read failed — enforcement is UNCONFIRMED", {
        namespace,
        err: err instanceof Error ? err.message : String(err),
      });
      return "unconfirmed";
    }
    if (!allowedTargetIp || !deniedTargetIp) return "unconfirmed";

    await deps.createNetworkPolicy(namespace, buildNetpolProbeIngressPolicy(namespace));
    await deps.createNetworkPolicy(namespace, buildNetpolProbeEgressPolicy(namespace));
    await deps.createPod(
      namespace,
      buildNetpolProbePodManifest({
        namespace,
        image,
        podName,
        allowedTargetIp,
        deniedTargetIp,
        ...(runtimeClassName ? { runtimeClassName } : {}),
        ...(imagePullSecretName ? { imagePullSecretName } : {}),
      }),
    );

    try {
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
    await deleteProbeResources(namespace, deps);
  }
}

export interface VerifyNetworkPolicyParams {
  namespace: string;
  image?: string;
  runtimeClassName?: string;
  imagePullSecretName?: string;
  deps?: NetworkPolicyProbeDeps;
}

export async function verifyNetworkPolicyEnforced(
  params: VerifyNetworkPolicyParams,
): Promise<NetpolGateDecision> {
  const image = params.image ?? NETPOL_PROBE_IMAGE;
  const deps = params.deps ?? createDefaultProbeDeps();

  const outcome = await runProbe(
    params.namespace,
    image,
    params.runtimeClassName,
    params.imagePullSecretName,
    deps,
  );
  const decision = decideNetworkPolicyGate({ outcome });

  const remediation = outcome === "reached" ? REACHED_REMEDIATION : UNCONFIRMED_REMEDIATION;
  const reason =
    outcome === "reached"
      ? "sandbox egress reached a target without an allow rule"
      : "could not confirm enforcement (probe never reported ALLOWED_REACHED plus DENIED_BLOCKED)";

  if (decision.action === "ok") {
    logger.info("NetworkPolicy enforcement verified — sandbox egress is isolated", {
      namespace: params.namespace,
    });
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
  const networkingApi = kc.makeApiClient(k8sLib.NetworkingV1Api);

  return {
    createPod: async (namespace, body) => {
      await coreApi.createNamespacedPod({ namespace, body });
    },
    readPod: (name, namespace) => coreApi.readNamespacedPod({ name, namespace }),
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
    createNetworkPolicy: async (namespace, body) => {
      await networkingApi.createNamespacedNetworkPolicy({ namespace, body });
    },
    deleteNetworkPolicy: async (name, namespace) => {
      await networkingApi.deleteNamespacedNetworkPolicy({ name, namespace });
    },
  };
}
