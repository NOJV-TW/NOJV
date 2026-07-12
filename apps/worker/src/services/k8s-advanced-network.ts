import type * as k8s from "@kubernetes/client-node";

import {
  HARDENED_CONTAINER_SECURITY_CONTEXT_PINNED,
  SANDBOX_NODE_SELECTOR,
  SANDBOX_POD_SECURITY_CONTEXT_WITH_FSGROUP,
  SANDBOX_TOLERATIONS,
} from "./k8s-pod-spec";
import {
  ADVANCED_SERVICE_PORT,
  SERVICE_HOST_ENV,
  SERVICE_PORT_ENV,
  SERVICE_READY_MARKER,
} from "./service-container";

export const EGRESS_LABEL_KEY = "nojv.egress";
export const SIDECAR_ROLE_LABEL_KEY = "nojv.sidecar";
export const SIDECAR_PORT = ADVANCED_SERVICE_PORT;

const SERVICE_POD_SECURITY_CONTEXT = SANDBOX_POD_SECURITY_CONTEXT_WITH_FSGROUP;
const SERVICE_CONTAINER_SECURITY_CONTEXT = HARDENED_CONTAINER_SECURITY_CONTEXT_PINNED;

export function runEgressLabel(submissionId: string): string {
  return submissionId;
}

export function gradeEgressLabel(submissionId: string): string {
  return `${submissionId}-grade`;
}

export function sidecarPodName(submissionId: string): string {
  return `judge-${submissionId}-sidecar`;
}

export function sidecarServiceName(submissionId: string): string {
  return `judge-${submissionId}-sidecar`;
}

export function runPolicyName(submissionId: string): string {
  return `judge-${submissionId}-run-egress`;
}

export function gradePolicyName(submissionId: string): string {
  return `judge-${submissionId}-grade-egress`;
}

export function sidecarPolicyName(submissionId: string): string {
  return `judge-${submissionId}-sidecar-egress`;
}

function sidecarPodLabels(submissionId: string): Record<string, string> {
  return { app: "nojv-sandbox", [SIDECAR_ROLE_LABEL_KEY]: submissionId };
}

export interface ServiceSidecarParams {
  submissionId: string;
  namespace: string;
  image: string;
  memoryMb: number;
  cpuLimit: string;
  port: number;
  imagePullSecretName?: string;
}

export function buildServiceSidecarPodManifest(params: ServiceSidecarParams): k8s.V1Pod {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: sidecarPodName(params.submissionId),
      namespace: params.namespace,
      labels: sidecarPodLabels(params.submissionId),
    },
    spec: {
      restartPolicy: "Never",
      automountServiceAccountToken: false,
      ...(params.imagePullSecretName
        ? { imagePullSecrets: [{ name: params.imagePullSecretName }] }
        : {}),
      nodeSelector: SANDBOX_NODE_SELECTOR,
      tolerations: SANDBOX_TOLERATIONS,
      securityContext: SERVICE_POD_SECURITY_CONTEXT,
      containers: [
        {
          name: "service",
          image: params.image,
          env: [{ name: SERVICE_PORT_ENV, value: String(params.port) }],
          ports: [{ containerPort: params.port }],
          resources: {
            limits: {
              cpu: params.cpuLimit,
              memory: `${String(params.memoryMb)}Mi`,
              "ephemeral-storage": "256Mi",
            },
          },
          securityContext: SERVICE_CONTAINER_SECURITY_CONTEXT,
          volumeMounts: [{ name: "tmp", mountPath: "/tmp" }],
        },
      ],
      volumes: [{ name: "tmp", emptyDir: { sizeLimit: "256Mi" } }],
    },
  };
}

export function buildSidecarServiceManifest(params: {
  submissionId: string;
  namespace: string;
  port: number;
}): k8s.V1Service {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: sidecarServiceName(params.submissionId),
      namespace: params.namespace,
      labels: { app: "nojv-sandbox", [SIDECAR_ROLE_LABEL_KEY]: params.submissionId },
    },
    spec: {
      type: "ClusterIP",
      selector: { [SIDECAR_ROLE_LABEL_KEY]: params.submissionId },
      ports: [{ port: params.port, targetPort: params.port, protocol: "TCP" }],
    },
  };
}

export function buildRunEgressPolicy(params: {
  submissionId: string;
  namespace: string;
}): k8s.V1NetworkPolicy {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name: runPolicyName(params.submissionId),
      namespace: params.namespace,
      labels: { app: "nojv-sandbox" },
    },
    spec: {
      podSelector: {
        matchLabels: { [EGRESS_LABEL_KEY]: runEgressLabel(params.submissionId) },
      },
      policyTypes: ["Ingress", "Egress"],
      ingress: [],
      egress: [
        {
          to: [
            {
              podSelector: {
                matchLabels: { [SIDECAR_ROLE_LABEL_KEY]: params.submissionId },
              },
            },
          ],
        },
      ],
    },
  };
}

export function buildGradeEgressPolicy(params: {
  submissionId: string;
  namespace: string;
}): k8s.V1NetworkPolicy {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name: gradePolicyName(params.submissionId),
      namespace: params.namespace,
      labels: { app: "nojv-sandbox" },
    },
    spec: {
      podSelector: {
        matchLabels: { [EGRESS_LABEL_KEY]: gradeEgressLabel(params.submissionId) },
      },
      policyTypes: ["Ingress", "Egress"],
      ingress: [],
      egress: [],
    },
  };
}

export function buildSidecarNetworkPolicy(params: {
  submissionId: string;
  namespace: string;
}): k8s.V1NetworkPolicy {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name: sidecarPolicyName(params.submissionId),
      namespace: params.namespace,
      labels: { app: "nojv-sandbox" },
    },
    spec: {
      podSelector: {
        matchLabels: { [SIDECAR_ROLE_LABEL_KEY]: params.submissionId },
      },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          _from: [
            {
              podSelector: {
                matchLabels: { [EGRESS_LABEL_KEY]: runEgressLabel(params.submissionId) },
              },
            },
          ],
        },
      ],
      egress: [],
    },
  };
}

export function buildServiceRunEnv(serviceHost: string): Record<string, string> {
  return { [SERVICE_HOST_ENV]: `${serviceHost}:${String(ADVANCED_SERVICE_PORT)}` };
}

export { SERVICE_READY_MARKER };
