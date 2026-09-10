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

function prepareContainer(params: {
  name: string;
  image: string;
  payloadVolumeName: string;
  submissionVolumeName: string;
  artifactVolumeName: string;
  phase: "prepare" | "prepare-validator";
  scratchTmpVolumeName: string;
  scratchWorkspaceVolumeName: string;
  resources: k8s.V1ResourceRequirements;
}): k8s.V1Container {
  return {
    name: params.name,
    image: params.image,
    command: ["node", "/runner/index.js"],
    env: [
      { name: "SANDBOX_PHASE", value: params.phase },
      { name: "HOME", value: "/tmp" },
    ],
    resources: params.resources,
    securityContext: HARDENED_CONTAINER_SECURITY_CONTEXT,
    volumeMounts: [
      { name: params.payloadVolumeName, mountPath: "/payload", readOnly: true },
      { name: params.submissionVolumeName, mountPath: "/submission" },
      { name: params.artifactVolumeName, mountPath: "/artifact" },
      { name: params.scratchTmpVolumeName, mountPath: "/tmp", subPath: "prepare" },
      {
        name: params.scratchWorkspaceVolumeName,
        mountPath: "/workspace",
        subPath: "prepare",
      },
    ],
  };
}

export interface SandboxJobManifestParams {
  jobName: string;
  namespace: string;
  configMapNames: string[];
  image: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  compilerMemoryLimit: string;
  activeDeadlineSeconds: number;
  runtimeClassName?: string;
}

export function buildSandboxJobManifest(params: SandboxJobManifestParams): k8s.V1Job {
  const resources = {
    requests: {
      cpu: boundedRequest(params.cpuRequest, params.cpuLimit),
      memory: boundedRequest(params.memoryRequest, params.memoryLimit),
    },
    limits: { cpu: params.cpuLimit, memory: params.memoryLimit },
  };
  const compilerResources = {
    requests: {
      cpu: boundedRequest(params.cpuRequest, params.cpuLimit),
      memory: boundedRequest(params.memoryRequest, params.compilerMemoryLimit),
    },
    limits: { cpu: params.cpuLimit, memory: params.compilerMemoryLimit },
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
            prepareContainer({
              name: "prepare-validator",
              phase: "prepare-validator",
              image: params.image,
              payloadVolumeName: "payload",
              submissionVolumeName: "submission-data",
              artifactVolumeName: "artifact",
              scratchTmpVolumeName: "compiler-tmp",
              scratchWorkspaceVolumeName: "workspace",
              resources: compilerResources,
            }),
          ],
          containers: [
            {
              name: "runner",
              image: params.image,
              command: ["node", "/runner/index.js"],
              env: [
                { name: "PYTHONDONTWRITEBYTECODE", value: "1" },
                { name: "HOME", value: "/tmp" },
              ],
              resources,
              securityContext: HARDENED_CONTAINER_SECURITY_CONTEXT,
              volumeMounts: [
                {
                  name: "submission-data",
                  mountPath: "/submission",
                  readOnly: true,
                },
                { name: "artifact", mountPath: "/artifact", readOnly: true },
                { name: "workspace", mountPath: "/workspace", subPath: "validate" },
                { name: "tmp", mountPath: "/tmp" },
              ],
            },
          ],
          volumes: [
            payloadVolume("payload", params.configMapNames),
            { name: "submission-data", emptyDir: { sizeLimit: SUBMISSION_DATA_SIZE_LIMIT } },
            { name: "artifact", emptyDir: { sizeLimit: "256Mi" } },
            {
              name: "compiler-tmp",
              emptyDir: { sizeLimit: `${String(COMPILER_SCRATCH_MB)}Mi` },
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
  configMapNames: string[];
  image: string;
  cpuRequest: string;
  caseCpuRequest?: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  compilerMemoryLimit: string;
  activeDeadlineSeconds: number;
  caseIndices: number[];
  runtimeClassName?: string;
}

export function perCaseContainerName(index: number): string {
  return `case-${String(index)}`;
}

export const PREPARE_CONTAINER_NAME = "prepare";

export function buildPerCaseSandboxJobManifest(
  params: PerCaseSandboxJobManifestParams,
): k8s.V1Job {
  const containerSecurityContext = HARDENED_CONTAINER_SECURITY_CONTEXT;
  const resources = {
    requests: {
      cpu: boundedRequest(params.cpuRequest, params.cpuLimit),
      memory: boundedRequest(params.memoryRequest, params.compilerMemoryLimit),
    },
    limits: { cpu: params.cpuLimit, memory: params.compilerMemoryLimit },
  };
  const caseResources = {
    requests: {
      cpu: boundedRequest(params.caseCpuRequest ?? params.cpuRequest, params.cpuLimit),
      memory: boundedRequest(params.memoryRequest, params.memoryLimit),
    },
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
          ...runtimeClassField(params.runtimeClassName),
          nodeSelector: SANDBOX_NODE_SELECTOR,
          tolerations: SANDBOX_TOLERATIONS,
          securityContext: SANDBOX_POD_SECURITY_CONTEXT,
          initContainers: [
            prepareContainer({
              name: PREPARE_CONTAINER_NAME,
              phase: "prepare",
              image: params.image,
              payloadVolumeName: "payload",
              submissionVolumeName: "submission-data",
              artifactVolumeName: "artifact",
              scratchTmpVolumeName: "compiler-tmp",
              scratchWorkspaceVolumeName: "scratch-workspace",
              resources,
            }),
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
            resources: caseResources,
            securityContext: containerSecurityContext,
            volumeMounts: baseMounts(true, perCaseContainerName(index)),
          })),
          volumes: [
            payloadVolume("payload", params.configMapNames),
            { name: "submission-data", emptyDir: { sizeLimit: SUBMISSION_DATA_SIZE_LIMIT } },
            { name: "artifact", emptyDir: { sizeLimit: "256Mi" } },
            {
              name: "compiler-tmp",
              emptyDir: { sizeLimit: `${String(COMPILER_SCRATCH_MB)}Mi` },
            },
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
