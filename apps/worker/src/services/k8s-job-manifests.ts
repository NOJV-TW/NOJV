import type * as k8s from "@kubernetes/client-node";
import { findSuffix, quantityToScalar } from "@kubernetes/client-node/dist/util.js";
import { COMPILER_SCRATCH_MB } from "@nojv/core";

import {
  HARDENED_CONTAINER_SECURITY_CONTEXT,
  SANDBOX_NODE_SELECTOR,
  SANDBOX_POD_SECURITY_CONTEXT,
  SANDBOX_TOLERATIONS,
  runtimeClassField,
} from "./k8s-pod-spec";

const TTL_AFTER_FINISHED_SECONDS = 60;
const SUBMISSION_DATA_SIZE_LIMIT = "128Mi";

function quantityValue(quantity: string): number {
  const suffix = findSuffix(quantity);
  const value = suffix
    ? Number(quantity.slice(0, -suffix.length)) * Number(quantityToScalar(`1${suffix}`))
    : Number(quantityToScalar(quantity));
  if (!Number.isFinite(value))
    throw new Error(`Invalid Kubernetes resource quantity: ${quantity}`);
  return value;
}

function boundedRequest(request: string, limit: string): string {
  return quantityValue(request) > quantityValue(limit) ? limit : request;
}

function payloadVolume(name: string, configMapNames: string[]): k8s.V1Volume {
  return {
    name,
    projected: {
      sources: configMapNames.map((configMapName) => ({
        configMap: { name: configMapName },
      })),
    },
  };
}

function materializerContainer(params: {
  name: string;
  image: string;
  payloadVolumeName: string;
  submissionVolumeName: string;
  resources: k8s.V1ResourceRequirements;
}): k8s.V1Container {
  return {
    name: params.name,
    image: params.image,
    command: ["node", "/runner/index.js"],
    env: [{ name: "SANDBOX_PHASE", value: "materialize" }],
    resources: params.resources,
    securityContext: HARDENED_CONTAINER_SECURITY_CONTEXT,
    volumeMounts: [
      { name: params.payloadVolumeName, mountPath: "/payload", readOnly: true },
      { name: params.submissionVolumeName, mountPath: "/submission" },
    ],
  };
}

export const RUN_CONTAINER_NAME = "run";
export const JUDGE_CONTAINER_NAME = "judge";

export interface StageJobManifestParams {
  jobName: string;
  namespace: string;
  runConfigMapNames: string[];
  judgeConfigMapNames: string[];
  image: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  compilerMemoryLimit: string;
  runParallelism: number;
  runMemoryLimit: string;
  activeDeadlineSeconds: number;
  runtimeClassName?: string;
}

export function buildStageJobManifest(params: StageJobManifestParams): k8s.V1Job {
  const compilerResources = {
    requests: {
      cpu: boundedRequest(params.cpuRequest, params.cpuLimit),
      memory: boundedRequest(params.memoryRequest, params.compilerMemoryLimit),
    },
    limits: { cpu: params.cpuLimit, memory: params.compilerMemoryLimit },
  };
  const runCpu = String(params.runParallelism);
  const runResources = {
    requests: {
      cpu: runCpu,
      memory: boundedRequest(params.memoryRequest, params.runMemoryLimit),
    },
    limits: { cpu: runCpu, memory: params.runMemoryLimit },
  };
  const env = (phase: string) => [
    { name: "SANDBOX_PHASE", value: phase },
    { name: "PYTHONDONTWRITEBYTECODE", value: "1" },
    { name: "HOME", value: "/tmp" },
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
          ...runtimeClassField(params.runtimeClassName),
          nodeSelector: SANDBOX_NODE_SELECTOR,
          tolerations: SANDBOX_TOLERATIONS,
          securityContext: SANDBOX_POD_SECURITY_CONTEXT,
          initContainers: [
            {
              name: RUN_CONTAINER_NAME,
              image: params.image,
              command: ["node", "/runner/index.js"],
              env: env("run-stage"),
              resources: runResources,
              securityContext: HARDENED_CONTAINER_SECURITY_CONTEXT,
              volumeMounts: [
                { name: "run-payload", mountPath: "/payload", readOnly: true },
                { name: "submission-data", mountPath: "/submission" },
                { name: "artifact", mountPath: "/artifact" },
                { name: "run-workspace", mountPath: "/workspace" },
                { name: "run-tmp", mountPath: "/tmp" },
                { name: "outputs", mountPath: "/outputs" },
              ],
            },
          ],
          containers: [
            {
              name: JUDGE_CONTAINER_NAME,
              image: params.image,
              command: ["node", "/runner/index.js"],
              env: env("judge-stage"),
              resources: compilerResources,
              securityContext: HARDENED_CONTAINER_SECURITY_CONTEXT,
              volumeMounts: [
                { name: "judge-payload", mountPath: "/payload", readOnly: true },
                { name: "judge-data", mountPath: "/submission" },
                { name: "judge-artifact", mountPath: "/artifact" },
                { name: "outputs", mountPath: "/outputs", readOnly: true },
                { name: "judge-tmp", mountPath: "/tmp" },
                { name: "judge-workspace", mountPath: "/workspace" },
              ],
            },
          ],
          volumes: [
            payloadVolume("run-payload", params.runConfigMapNames),
            payloadVolume("judge-payload", params.judgeConfigMapNames),
            { name: "submission-data", emptyDir: { sizeLimit: SUBMISSION_DATA_SIZE_LIMIT } },
            { name: "artifact", emptyDir: { sizeLimit: "256Mi" } },
            { name: "run-workspace", emptyDir: { sizeLimit: "256Mi" } },
            {
              name: "run-tmp",
              emptyDir: { sizeLimit: `${String(COMPILER_SCRATCH_MB)}Mi` },
            },
            { name: "outputs", emptyDir: { sizeLimit: "512Mi" } },
            { name: "judge-data", emptyDir: { sizeLimit: SUBMISSION_DATA_SIZE_LIMIT } },
            { name: "judge-artifact", emptyDir: { sizeLimit: "256Mi" } },
            {
              name: "judge-tmp",
              emptyDir: { sizeLimit: `${String(COMPILER_SCRATCH_MB)}Mi` },
            },
            { name: "judge-workspace", emptyDir: { sizeLimit: "128Mi" } },
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
  solutionConfigMapNames: string[];
  interactorConfigMapNames: string[];
  image: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  activeDeadlineSeconds: number;
  runtimeClassName?: string;
}

export function buildInteractiveJobManifest(params: InteractiveJobManifestParams): k8s.V1Job {
  const containerSecurityContext = HARDENED_CONTAINER_SECURITY_CONTEXT;
  const resources = {
    requests: {
      cpu: boundedRequest(params.cpuRequest, params.cpuLimit),
      memory: boundedRequest(params.memoryRequest, params.memoryLimit),
    },
    limits: { cpu: params.cpuLimit, memory: params.memoryLimit },
  };
  const solutionResources = {
    ...resources,
    requests: { ...resources.requests, cpu: params.cpuLimit },
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
          ...runtimeClassField(params.runtimeClassName),
          nodeSelector: SANDBOX_NODE_SELECTOR,
          tolerations: SANDBOX_TOLERATIONS,
          securityContext: SANDBOX_POD_SECURITY_CONTEXT,
          initContainers: [
            materializerContainer({
              name: "materialize-solution",
              image: params.image,
              payloadVolumeName: "solution-payload",
              submissionVolumeName: "solution-data",
              resources,
            }),
            materializerContainer({
              name: "materialize-interactor",
              image: params.image,
              payloadVolumeName: "interactor-payload",
              submissionVolumeName: "interactor-data",
              resources,
            }),
          ],
          containers: [
            {
              name: "solution",
              image: params.image,
              command: buildSolutionContainerCommand(),
              resources: solutionResources,
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
            payloadVolume("solution-payload", params.solutionConfigMapNames),
            payloadVolume("interactor-payload", params.interactorConfigMapNames),
            { name: "solution-data", emptyDir: { sizeLimit: SUBMISSION_DATA_SIZE_LIMIT } },
            { name: "interactor-data", emptyDir: { sizeLimit: SUBMISSION_DATA_SIZE_LIMIT } },
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
