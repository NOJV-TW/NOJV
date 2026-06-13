import type * as k8s from "@kubernetes/client-node";
import type { SandboxRequest } from "@nojv/core";

import { resolveSourceFiles } from "./source-files.js";

const TTL_AFTER_FINISHED_SECONDS = 60;

export const ADVANCED_INIT_NAME = "prep";
export const ADVANCED_GRADER_NAME = "grader";
export const ADVANCED_SIDECAR_NAME = "emit-result";
export const ADVANCED_RESULT_MARKER_BEGIN = "<<<NOJV_ADVANCED_RESULT>>>";
export const ADVANCED_RESULT_MARKER_END = "<<<END>>>";

const ADVANCED_WORKSPACE_SIZE_LIMIT = "1Gi";
const ADVANCED_TMP_SIZE_LIMIT = "64Mi";

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

export interface AdvancedJobManifestParams {
  jobName: string;
  namespace: string;
  configMapName: string;
  sandboxImage: string;
  graderImage: string;
  memoryMb: number;
  totalTimeMs: number;
  cpuLimit: string;
  submissionId: string;
  language: string;
}

export function buildAdvancedJobManifest(params: AdvancedJobManifestParams): k8s.V1Job {
  const sharedWorkspaceMount = { name: "workspace", mountPath: "/workspace" };
  const totalTimeoutSeconds = Math.ceil(params.totalTimeMs / 1000) + 30;

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
          labels: { app: "nojv-sandbox", "nojv-role": "sandbox" },
        },
        spec: {
          restartPolicy: "Never",
          automountServiceAccountToken: false,
          nodeSelector: { "nojv-role": "sandbox" },
          tolerations: [
            {
              key: "nojv-role",
              operator: "Equal",
              value: "sandbox",
              effect: "NoSchedule",
            },
          ],
          securityContext: {
            runAsUser: 10001,
            runAsGroup: 10001,
            fsGroup: 10001,
            runAsNonRoot: true,
            seccompProfile: { type: "RuntimeDefault" },
          },
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
              image: params.graderImage,
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
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
                readOnlyRootFilesystem: true,
                runAsNonRoot: true,
                runAsUser: 10001,
                runAsGroup: 10001,
              },
              volumeMounts: [sharedWorkspaceMount, { name: "tmp", mountPath: "/tmp" }],
            },
          ],
          volumes: [
            { name: "workspace", emptyDir: { sizeLimit: ADVANCED_WORKSPACE_SIZE_LIMIT } },
            { name: "tmp", emptyDir: { sizeLimit: ADVANCED_TMP_SIZE_LIMIT } },
            { name: "init-payload", configMap: { name: params.configMapName } },
          ],
        },
      },
    },
  };
}
