import type * as k8s from "@kubernetes/client-node";

import { PROXY_READY_MARKER, renderAllowlistEnv } from "./egress-proxy";
import {
  ADVANCED_SERVICE_PORT,
  SERVICE_HOST_ENV,
  SERVICE_PORT_ENV,
  SERVICE_READY_MARKER,
} from "./service-container";

export const EGRESS_LABEL_KEY = "nojv.egress";
export const SIDECAR_ROLE_LABEL_KEY = "nojv.sidecar";
export const SIDECAR_PORT = ADVANCED_SERVICE_PORT;

const SANDBOX_NODE_SELECTOR = { "nojv-role": "sandbox" };
const SANDBOX_TOLERATIONS = [
  { key: "nojv-role", operator: "Equal", value: "sandbox", effect: "NoSchedule" },
];
const PROXY_POD_SECURITY_CONTEXT = {
  runAsUser: 10001,
  runAsGroup: 10001,
  fsGroup: 10001,
  runAsNonRoot: true,
  seccompProfile: { type: "RuntimeDefault" },
};
const SERVICE_POD_SECURITY_CONTEXT = {
  runAsUser: 10001,
  runAsGroup: 10001,
  runAsNonRoot: true,
  seccompProfile: { type: "RuntimeDefault" },
};
const PROXY_CONTAINER_SECURITY_CONTEXT = {
  allowPrivilegeEscalation: false,
  capabilities: { drop: ["ALL"] },
  readOnlyRootFilesystem: true,
  runAsNonRoot: true,
  runAsUser: 10001,
  runAsGroup: 10001,
};
const SERVICE_CONTAINER_SECURITY_CONTEXT = {
  allowPrivilegeEscalation: false,
  capabilities: { drop: ["ALL"] },
  readOnlyRootFilesystem: true,
  runAsNonRoot: true,
  runAsUser: 10001,
  runAsGroup: 10001,
};
const SIDECAR_TMP_SIZE_LIMIT = "64Mi";

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

export interface ProxySidecarParams {
  submissionId: string;
  namespace: string;
  image: string;
  allowlist: string[];
  port: number;
}

export function buildProxySidecarPodManifest(params: ProxySidecarParams): k8s.V1Pod {
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
      nodeSelector: SANDBOX_NODE_SELECTOR,
      tolerations: SANDBOX_TOLERATIONS,
      securityContext: PROXY_POD_SECURITY_CONTEXT,
      containers: [
        {
          name: "egress-proxy",
          image: params.image,
          env: [
            { name: "NOJV_ALLOWLIST", value: renderAllowlistEnv(params.allowlist) },
            { name: "NOJV_PROXY_PORT", value: String(params.port) },
          ],
          ports: [{ containerPort: params.port }],
          resources: {
            requests: { cpu: "100m", memory: "64Mi" },
            limits: { cpu: "250m", memory: "128Mi", "ephemeral-storage": "64Mi" },
          },
          securityContext: PROXY_CONTAINER_SECURITY_CONTEXT,
          volumeMounts: [{ name: "tmp", mountPath: "/tmp" }],
        },
      ],
      volumes: [{ name: "tmp", emptyDir: { sizeLimit: SIDECAR_TMP_SIZE_LIMIT } }],
    },
  };
}

export interface ServiceSidecarParams {
  submissionId: string;
  namespace: string;
  image: string;
  memoryMb: number;
  cpuLimit: string;
  port: number;
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
      egress: [{}],
    },
  };
}

export function buildSidecarEgressPolicy(params: {
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
      egress: [{}],
    },
  };
}

export function buildProxyRunEnv(proxyHost: string, port: number): Record<string, string> {
  const url = `http://${proxyHost}:${String(port)}`;
  return {
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    http_proxy: url,
    https_proxy: url,
    NO_PROXY: "",
    no_proxy: "",
  };
}

export function buildServiceRunEnv(serviceHost: string): Record<string, string> {
  return { [SERVICE_HOST_ENV]: `${serviceHost}:${String(ADVANCED_SERVICE_PORT)}` };
}

export { PROXY_READY_MARKER, SERVICE_READY_MARKER };
