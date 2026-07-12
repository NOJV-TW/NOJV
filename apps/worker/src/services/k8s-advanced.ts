import type * as k8s from "@kubernetes/client-node";
import type { SandboxRequest } from "@nojv/core";

import {
  ADVANCED_OUTPUT_MAX_FILES,
  ADVANCED_WORKSPACE_MAX_BYTES,
  type RunStatus,
} from "./advanced-mode-executor";
import {
  HARDENED_CONTAINER_SECURITY_CONTEXT_PINNED,
  SANDBOX_NODE_SELECTOR,
  SANDBOX_POD_SECURITY_CONTEXT_WITH_FSGROUP,
  SANDBOX_TOLERATIONS,
} from "./k8s-pod-spec";
import { resolveSourceFiles } from "./source-files.js";

const TTL_AFTER_FINISHED_SECONDS = 60;
const RUN_POD_TERMINATION_GRACE_SECONDS = 120;

export const ADVANCED_INIT_NAME = "prep";
export const ADVANCED_RUN_NAME = "run";
export const ADVANCED_TRANSFER_NAME = "transfer";
export const ADVANCED_GRADER_NAME = "grader";
export const ADVANCED_SIDECAR_NAME = "emit-result";
export const ADVANCED_RESULT_MARKER_BEGIN = "<<<NOJV_ADVANCED_RESULT>>>";
export const ADVANCED_RESULT_MARKER_END = "<<<END>>>";

export const ADVANCED_PVC_MOUNT_PATH = "/run-output";
export const ADVANCED_GRADE_RUN_OUTPUT_PATH = "/workspace/run-output";

const ADVANCED_WORKSPACE_SIZE_LIMIT = "1Gi";
const ADVANCED_TMP_SIZE_LIMIT = "64Mi";
const ADVANCED_PVC_STORAGE = "1Gi";

export function advancedPvcName(submissionId: string): string {
  return `judge-${submissionId}-runout`;
}

export function buildAdvancedConfigMapData(request: SandboxRequest): Record<string, string> {
  const advanced = request.advanced;
  const submissionFiles = resolveSourceFiles(request, { requireSourceCode: true });

  const payload = {
    meta: {
      submissionId: request.submissionId,
      language: request.language,
      submissionFiles: submissionFiles.map((f) => f.path),
      resourceLimits: {
        totalTimeMs: advanced?.totalTimeMs ?? request.limits.timeoutMs,
        memoryMb: advanced?.memoryMb ?? request.limits.memoryMb,
      },
    },
    submissionFiles,
  };

  return { "payload.json": JSON.stringify(payload) };
}

export function buildAdvancedGradeConfigMapData(
  submissionId: string,
  language: string,
  runStatus: RunStatus,
  maxScore: number,
): Record<string, string> {
  return {
    "meta.json": JSON.stringify({ submissionId, language, runStatus, maxScore }, null, 2),
  };
}

export function buildAdvancedInitScript(): string {
  return `set -eu
mkdir -p /workspace/submission /workspace/output
node -e '
const fs = require("fs");
const path = require("path");
const payload = JSON.parse(fs.readFileSync("/init-payload/payload.json", "utf8"));
fs.writeFileSync("/workspace/meta.json", JSON.stringify(payload.meta, null, 2));
for (const f of payload.submissionFiles) {
  const dest = path.join("/workspace/submission", f.path);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, f.content);
}
'
chmod 0777 /workspace/output
`;
}

const SAFE_COPY_GATE_JS = `
const fs = require("fs");
const path = require("path");
const SRC = process.env.NOJV_TRANSFER_SRC || "/workspace/output";
const DEST = process.env.NOJV_TRANSFER_DEST;
const MAX_FILES = Number(process.env.NOJV_TRANSFER_MAX_FILES);
const MAX_BYTES = Number(process.env.NOJV_TRANSFER_MAX_BYTES);
const counters = { files: 0, bytes: 0 };
function copyTreeInto(srcDir, destDir) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    const info = fs.lstatSync(srcPath);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyTreeInto(srcPath, destPath);
      continue;
    }
    if (!info.isFile()) continue;
    counters.files += 1;
    counters.bytes += info.size;
    if (counters.files > MAX_FILES) {
      throw new Error("NOJV_TRANSFER_FILE_CAP");
    }
    if (counters.bytes > MAX_BYTES) {
      throw new Error("NOJV_TRANSFER_BYTE_CAP");
    }
    fs.copyFileSync(srcPath, destPath);
  }
}
fs.mkdirSync(DEST, { recursive: true });
copyTreeInto(SRC, DEST);
`;

export function buildAdvancedTransferScript(): string {
  return SAFE_COPY_GATE_JS;
}

export function buildAdvancedTransferWaitScript(): string {
  return `set -u
copy() {
  NOJV_TRANSFER_DEST=${ADVANCED_PVC_MOUNT_PATH} NOJV_TRANSFER_MAX_FILES=${String(ADVANCED_OUTPUT_MAX_FILES)} NOJV_TRANSFER_MAX_BYTES=${String(ADVANCED_WORKSPACE_MAX_BYTES)} node -e '${SAFE_COPY_GATE_JS}'
  exit $?
}
trap copy TERM INT
while true; do sleep 1 & wait $!; done
`;
}

export function buildAdvancedTailScript(totalTimeMs: number): string {
  const timeoutS = Math.ceil(totalTimeMs / 1000) + 30;
  return `set -u
RESULT=/workspace/output/result.json
TIMEOUT=${String(timeoutS)}
DEADLINE=$(( $(date +%s) + TIMEOUT ))
while [ ! -f "$RESULT" ] && [ "$(date +%s)" -lt "$DEADLINE" ]; do sleep 0.25; done
sleep 0.2
echo '${ADVANCED_RESULT_MARKER_BEGIN}'
if [ -f "$RESULT" ]; then cat "$RESULT"; else echo '{"missing":true}'; fi
echo
echo '${ADVANCED_RESULT_MARKER_END}'
`;
}

export function parseAdvancedResultLog(logs: string): unknown {
  const begin = logs.indexOf(ADVANCED_RESULT_MARKER_BEGIN);
  if (begin < 0) return null;
  const after = begin + ADVANCED_RESULT_MARKER_BEGIN.length;
  const end = logs.indexOf(ADVANCED_RESULT_MARKER_END, after);
  if (end < 0) return null;
  const inner = logs.slice(after, end).trim();
  try {
    return JSON.parse(inner);
  } catch {
    return null;
  }
}

export function deriveRunStatusFromJob(
  outcome: "succeeded" | "failed",
  deadlineExceeded: boolean,
): RunStatus {
  if (deadlineExceeded) {
    return { state: "timed_out", exitCode: null };
  }
  if (outcome === "failed") {
    return { state: "exited", exitCode: 1 };
  }
  return { state: "exited", exitCode: 0 };
}

const RUN_POD_SECURITY_CONTEXT = SANDBOX_POD_SECURITY_CONTEXT_WITH_FSGROUP;
const HARDENED_CONTAINER_SECURITY_CONTEXT = HARDENED_CONTAINER_SECURITY_CONTEXT_PINNED;

export interface AdvancedPvcManifestParams {
  pvcName: string;
  namespace: string;
}

export function buildAdvancedPvcManifest(
  params: AdvancedPvcManifestParams,
): k8s.V1PersistentVolumeClaim {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: params.pvcName,
      namespace: params.namespace,
      labels: { app: "nojv-sandbox" },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: { requests: { storage: ADVANCED_PVC_STORAGE } },
    },
  };
}

export interface AdvancedRunJobManifestParams {
  jobName: string;
  namespace: string;
  configMapName: string;
  pvcName: string;
  sandboxImage: string;
  runImage: string;
  memoryMb: number;
  totalTimeMs: number;
  cpuLimit: string;
  submissionId: string;
  language: string;
  egressLabel?: string;
  extraEnv?: Record<string, string>;
  imagePullSecretName?: string;
}

export function buildAdvancedRunJobManifest(params: AdvancedRunJobManifestParams): k8s.V1Job {
  const sharedWorkspaceMount = { name: "workspace", mountPath: "/workspace" };
  const totalTimeoutSeconds = Math.ceil(params.totalTimeMs / 1000) + 30;
  const podLabels = {
    app: "nojv-sandbox",
    "nojv-role": "sandbox",
    ...(params.egressLabel ? { "nojv.egress": params.egressLabel } : {}),
  };
  const runEnv = [
    { name: "SUBMISSION_ID", value: params.submissionId },
    { name: "LANGUAGE", value: params.language },
    ...Object.entries(params.extraEnv ?? {}).map(([name, value]) => ({ name, value })),
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
      activeDeadlineSeconds: totalTimeoutSeconds,
      backoffLimit: 0,
      template: {
        metadata: {
          labels: podLabels,
        },
        spec: {
          restartPolicy: "Never",
          automountServiceAccountToken: false,
          ...(params.imagePullSecretName
            ? { imagePullSecrets: [{ name: params.imagePullSecretName }] }
            : {}),
          terminationGracePeriodSeconds: RUN_POD_TERMINATION_GRACE_SECONDS,
          nodeSelector: SANDBOX_NODE_SELECTOR,
          tolerations: SANDBOX_TOLERATIONS,
          securityContext: RUN_POD_SECURITY_CONTEXT,
          initContainers: [
            {
              name: ADVANCED_INIT_NAME,
              image: params.sandboxImage,
              command: ["sh", "-c", buildAdvancedInitScript()],
              volumeMounts: [
                sharedWorkspaceMount,
                { name: "init-payload", mountPath: "/init-payload", readOnly: true },
              ],
            },
            {
              name: ADVANCED_TRANSFER_NAME,
              image: params.sandboxImage,
              restartPolicy: "Always",
              command: ["sh", "-c", buildAdvancedTransferWaitScript()],
              volumeMounts: [
                sharedWorkspaceMount,
                { name: "run-output", mountPath: ADVANCED_PVC_MOUNT_PATH },
              ],
            },
          ],
          containers: [
            {
              name: ADVANCED_RUN_NAME,
              image: params.runImage,
              env: runEnv,
              workingDir: "/workspace",
              resources: {
                limits: {
                  memory: `${String(params.memoryMb)}Mi`,
                  cpu: params.cpuLimit,
                  "ephemeral-storage": ADVANCED_WORKSPACE_SIZE_LIMIT,
                },
              },
              securityContext: HARDENED_CONTAINER_SECURITY_CONTEXT,
              volumeMounts: [sharedWorkspaceMount, { name: "tmp", mountPath: "/tmp" }],
            },
          ],
          volumes: [
            { name: "workspace", emptyDir: { sizeLimit: ADVANCED_WORKSPACE_SIZE_LIMIT } },
            { name: "tmp", emptyDir: { sizeLimit: ADVANCED_TMP_SIZE_LIMIT } },
            { name: "init-payload", configMap: { name: params.configMapName } },
            { name: "run-output", persistentVolumeClaim: { claimName: params.pvcName } },
          ],
        },
      },
    },
  };
}

export interface AdvancedGradeJobManifestParams {
  jobName: string;
  namespace: string;
  configMapName: string;
  pvcName: string;
  sandboxImage: string;
  gradeImage: string;
  memoryMb: number;
  totalTimeMs: number;
  cpuLimit: string;
  submissionId: string;
  language: string;
  nodeName: string;
  egressLabel: string;
  imagePullSecretName?: string;
}

export function buildAdvancedGradeJobManifest(
  params: AdvancedGradeJobManifestParams,
): k8s.V1Job {
  const sharedWorkspaceMount = { name: "workspace", mountPath: "/workspace" };
  const totalTimeoutSeconds = Math.ceil(params.totalTimeMs / 1000) + 30;
  const podLabels = {
    app: "nojv-sandbox",
    "nojv-role": "sandbox",
    "nojv.egress": params.egressLabel,
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
      activeDeadlineSeconds: totalTimeoutSeconds,
      backoffLimit: 0,
      template: {
        metadata: {
          labels: podLabels,
        },
        spec: {
          restartPolicy: "Never",
          automountServiceAccountToken: false,
          ...(params.imagePullSecretName
            ? { imagePullSecrets: [{ name: params.imagePullSecretName }] }
            : {}),
          nodeName: params.nodeName,
          nodeSelector: SANDBOX_NODE_SELECTOR,
          tolerations: SANDBOX_TOLERATIONS,
          securityContext: RUN_POD_SECURITY_CONTEXT,
          initContainers: [
            {
              name: ADVANCED_INIT_NAME,
              image: params.sandboxImage,
              command: [
                "sh",
                "-c",
                `set -eu
mkdir -p /workspace/output
cp /grade-meta/meta.json /workspace/meta.json
chmod 0777 /workspace/output
`,
              ],
              volumeMounts: [
                sharedWorkspaceMount,
                { name: "grade-meta", mountPath: "/grade-meta", readOnly: true },
              ],
            },
            {
              name: ADVANCED_SIDECAR_NAME,
              image: params.sandboxImage,
              restartPolicy: "Always",
              command: ["sh", "-c", buildAdvancedTailScript(params.totalTimeMs)],
              volumeMounts: [sharedWorkspaceMount],
            },
          ],
          containers: [
            {
              name: ADVANCED_GRADER_NAME,
              image: params.gradeImage,
              env: [
                { name: "SUBMISSION_ID", value: params.submissionId },
                { name: "LANGUAGE", value: params.language },
              ],
              workingDir: "/workspace",
              resources: {
                limits: {
                  memory: `${String(params.memoryMb)}Mi`,
                  cpu: params.cpuLimit,
                  "ephemeral-storage": ADVANCED_WORKSPACE_SIZE_LIMIT,
                },
              },
              securityContext: HARDENED_CONTAINER_SECURITY_CONTEXT,
              volumeMounts: [
                sharedWorkspaceMount,
                {
                  name: "run-output",
                  mountPath: ADVANCED_GRADE_RUN_OUTPUT_PATH,
                  readOnly: true,
                },
                { name: "tmp", mountPath: "/tmp" },
              ],
            },
          ],
          volumes: [
            { name: "workspace", emptyDir: { sizeLimit: ADVANCED_WORKSPACE_SIZE_LIMIT } },
            { name: "tmp", emptyDir: { sizeLimit: ADVANCED_TMP_SIZE_LIMIT } },
            { name: "grade-meta", configMap: { name: params.configMapName } },
            {
              name: "run-output",
              persistentVolumeClaim: { claimName: params.pvcName, readOnly: true },
            },
          ],
        },
      },
    },
  };
}
