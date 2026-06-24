import type * as k8s from "@kubernetes/client-node";

import {
  HARDENED_CONTAINER_SECURITY_CONTEXT,
  SANDBOX_NODE_SELECTOR,
  SANDBOX_POD_SECURITY_CONTEXT,
  SANDBOX_TOLERATIONS,
} from "./k8s-pod-spec";

const TTL_AFTER_FINISHED_SECONDS = 60;

export interface SandboxJobManifestParams {
  jobName: string;
  namespace: string;
  configMapName: string;
  image: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  activeDeadlineSeconds: number;
}

export function buildSandboxJobManifest(params: SandboxJobManifestParams): k8s.V1Job {
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: params.jobName,
      namespace: params.namespace,
      labels: { app: "nojv-sandbox" },
    },
    spec: {
      ttlSecondsAfterFinished: TTL_AFTER_FINISHED_SECONDS,
      activeDeadlineSeconds: params.activeDeadlineSeconds,
      backoffLimit: 0,
      template: {
        metadata: {
          labels: { app: "nojv-sandbox", "nojv-role": "sandbox" },
        },
        spec: {
          restartPolicy: "Never",
          automountServiceAccountToken: false,
          nodeSelector: SANDBOX_NODE_SELECTOR,
          tolerations: SANDBOX_TOLERATIONS,
          securityContext: SANDBOX_POD_SECURITY_CONTEXT,
          containers: [
            {
              name: "runner",
              image: params.image,
              command: ["node", "/runner/index.js"],
              resources: {
                requests: { cpu: params.cpuRequest, memory: params.memoryRequest },
                limits: { cpu: params.cpuLimit, memory: params.memoryLimit },
              },
              securityContext: HARDENED_CONTAINER_SECURITY_CONTEXT,
              volumeMounts: [
                {
                  name: "submission-data",
                  mountPath: "/submission",
                  readOnly: true,
                },
                { name: "workspace", mountPath: "/workspace" },
                { name: "tmp", mountPath: "/tmp" },
              ],
            },
          ],
          volumes: [
            {
              name: "submission-data",
              configMap: { name: params.configMapName },
            },
            {
              name: "workspace",
              emptyDir: { sizeLimit: "128Mi" },
            },
            {
              name: "tmp",
              emptyDir: { sizeLimit: "64Mi" },
            },
          ],
        },
      },
    },
  };
}

export interface PerCaseSandboxJobManifestParams {
  jobName: string;
  namespace: string;
  configMapName: string;
  image: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  activeDeadlineSeconds: number;
  caseIndices: number[];
}

export function perCaseContainerName(index: number): string {
  return `case-${String(index)}`;
}

export const COMPILE_CONTAINER_NAME = "compile";

export function buildPerCaseSandboxJobManifest(
  params: PerCaseSandboxJobManifestParams,
): k8s.V1Job {
  const containerSecurityContext = HARDENED_CONTAINER_SECURITY_CONTEXT;
  const resources = {
    requests: { cpu: params.cpuRequest, memory: params.memoryRequest },
    limits: { cpu: params.cpuLimit, memory: params.memoryLimit },
  };
  const baseMounts = (artifactReadOnly: boolean, scratchKey: string) => [
    { name: "submission-data", mountPath: "/submission", readOnly: true },
    { name: "artifact", mountPath: "/artifact", readOnly: artifactReadOnly },
    { name: "scratch-tmp", mountPath: "/tmp", subPath: scratchKey },
    { name: "scratch-workspace", mountPath: "/workspace", subPath: scratchKey },
  ];

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: params.jobName,
      namespace: params.namespace,
      labels: { app: "nojv-sandbox" },
    },
    spec: {
      ttlSecondsAfterFinished: TTL_AFTER_FINISHED_SECONDS,
      activeDeadlineSeconds: params.activeDeadlineSeconds,
      backoffLimit: 0,
      template: {
        metadata: { labels: { app: "nojv-sandbox", "nojv-role": "sandbox" } },
        spec: {
          restartPolicy: "Never",
          automountServiceAccountToken: false,
          nodeSelector: SANDBOX_NODE_SELECTOR,
          tolerations: SANDBOX_TOLERATIONS,
          securityContext: SANDBOX_POD_SECURITY_CONTEXT,
          initContainers: [
            {
              name: COMPILE_CONTAINER_NAME,
              image: params.image,
              command: ["node", "/runner/index.js"],
              env: [
                { name: "SANDBOX_PHASE", value: "compile" },
                { name: "HOME", value: "/tmp" },
              ],
              resources,
              securityContext: containerSecurityContext,
              volumeMounts: baseMounts(false, "compile"),
            },
          ],
          containers: params.caseIndices.map((index) => ({
            name: perCaseContainerName(index),
            image: params.image,
            command: ["node", "/runner/index.js"],
            env: [
              { name: "SANDBOX_PHASE", value: "run-case" },
              { name: "SANDBOX_CASE_INDEX", value: String(index) },
              { name: "PYTHONDONTWRITEBYTECODE", value: "1" },
              { name: "HOME", value: "/tmp" },
            ],
            resources,
            securityContext: containerSecurityContext,
            volumeMounts: baseMounts(true, perCaseContainerName(index)),
          })),
          volumes: [
            { name: "submission-data", configMap: { name: params.configMapName } },
            { name: "artifact", emptyDir: { sizeLimit: "256Mi" } },
            { name: "scratch-tmp", emptyDir: { sizeLimit: "64Mi" } },
            { name: "scratch-workspace", emptyDir: { sizeLimit: "128Mi" } },
          ],
        },
      },
    },
  };
}

export const INTERACTIVE_SOCKET_PORT = 7777;

export function buildSolutionContainerCommand(): string[] {
  return [
    "sh",
    "-c",
    `exec socat EXEC:"node /runner/index.js" TCP:127.0.0.1:${String(INTERACTIVE_SOCKET_PORT)},retry=40,interval=0.25`,
  ];
}

export function buildInteractorContainerCommand(): string[] {
  return [
    "sh",
    "-c",
    `exec socat TCP-LISTEN:${String(INTERACTIVE_SOCKET_PORT)},reuseaddr EXEC:"node /runner/index.js"`,
  ];
}

export interface InteractiveJobManifestParams {
  jobName: string;
  namespace: string;
  solutionConfigMapName: string;
  interactorConfigMapName: string;
  image: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  activeDeadlineSeconds: number;
}

export function buildInteractiveJobManifest(params: InteractiveJobManifestParams): k8s.V1Job {
  const containerSecurityContext = HARDENED_CONTAINER_SECURITY_CONTEXT;
  const resources = {
    requests: { cpu: params.cpuRequest, memory: params.memoryRequest },
    limits: { cpu: params.cpuLimit, memory: params.memoryLimit },
  };

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: params.jobName,
      namespace: params.namespace,
      labels: { app: "nojv-sandbox" },
    },
    spec: {
      ttlSecondsAfterFinished: TTL_AFTER_FINISHED_SECONDS,
      activeDeadlineSeconds: params.activeDeadlineSeconds,
      backoffLimit: 0,
      template: {
        metadata: {
          labels: { app: "nojv-sandbox", "nojv-role": "sandbox" },
        },
        spec: {
          restartPolicy: "Never",
          automountServiceAccountToken: false,
          nodeSelector: SANDBOX_NODE_SELECTOR,
          tolerations: SANDBOX_TOLERATIONS,
          securityContext: SANDBOX_POD_SECURITY_CONTEXT,
          containers: [
            {
              name: "solution",
              image: params.image,
              command: buildSolutionContainerCommand(),
              resources,
              securityContext: containerSecurityContext,
              volumeMounts: [
                { name: "solution-data", mountPath: "/submission", readOnly: true },
                { name: "solution-workspace", mountPath: "/workspace" },
                { name: "solution-tmp", mountPath: "/tmp" },
              ],
            },
            {
              name: "interactor",
              image: params.image,
              command: buildInteractorContainerCommand(),
              resources,
              securityContext: containerSecurityContext,
              volumeMounts: [
                { name: "interactor-data", mountPath: "/submission", readOnly: true },
                { name: "interactor-workspace", mountPath: "/workspace" },
                { name: "interactor-tmp", mountPath: "/tmp" },
              ],
            },
          ],
          volumes: [
            {
              name: "solution-data",
              configMap: { name: params.solutionConfigMapName },
            },
            {
              name: "interactor-data",
              configMap: { name: params.interactorConfigMapName },
            },
            { name: "solution-workspace", emptyDir: { sizeLimit: "128Mi" } },
            { name: "solution-tmp", emptyDir: { sizeLimit: "64Mi" } },
            { name: "interactor-workspace", emptyDir: { sizeLimit: "128Mi" } },
            { name: "interactor-tmp", emptyDir: { sizeLimit: "64Mi" } },
          ],
        },
      },
    },
  };
}
