import { createRequire } from "node:module";

import type * as k8s from "@kubernetes/client-node";

const require = createRequire(import.meta.url);

import {
  advancedResultSchema,
  normalizeRelativePath,
  sourceFileNames,
  type RawCaseRun,
  type SandboxExecutor,
  type SandboxRequest,
  type SandboxResult,
  type SandboxTestcase,
  type SandboxTestcaseResult,
  type ValidatorOutcome,
} from "@nojv/core";
import { createLogger } from "../logger.js";
import { mergeInteractiveCase, type InteractiveSideResult } from "./check-interactive";
import { mergeCheckerResults, resolveSandboxResult } from "./check-standard";
import { advancedFallbackResult, mapAdvancedResult } from "./sandbox-result-mapper";
import { parseSandboxResult, parseValidateOutput } from "./sandbox-schema";
import { buildSandboxConfigJson, sandboxSystemError, sourceExtension } from "./sandbox-plan";

const logger = createLogger("k8s-executor");

export interface K8sExecutorConfig {
  namespace: string;
  image: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
}

const JOB_DEADLINE_FLOOR_SECONDS = 120;
const JOB_DEADLINE_CAP_SECONDS = 1_800;
const JOB_DEADLINE_BUFFER_SECONDS = 60;
const JOB_POLL_INTERVAL_MS = 1_000;
const TTL_AFTER_FINISHED_SECONDS = 60;
const CONFIGMAP_MAX_BYTES = 1_000_000;

export function computeJobDeadlineSeconds(request: SandboxRequest): number {
  const numCases = Math.max(1, request.testcases.length);
  const compute =
    Math.ceil((request.limits.timeoutMs * numCases) / 1000) + JOB_DEADLINE_BUFFER_SECONDS;
  return Math.min(Math.max(compute, JOB_DEADLINE_FLOOR_SECONDS), JOB_DEADLINE_CAP_SECONDS);
}

export function buildTestcaseConfigMapData(request: SandboxRequest): Record<string, string> {
  const data: Record<string, string> = {};
  const shipExpected = request.judgeType !== "standard" && request.judgeType !== "checker";

  for (const tc of request.testcases) {
    data[`testcase-${String(tc.index)}-input.txt`] = tc.input;
    if (shipExpected && tc.output != null) {
      data[`testcase-${String(tc.index)}-expected.txt`] = tc.output;
    }
  }

  return data;
}

export function buildRunConfigMapData(request: SandboxRequest): Record<string, string> {
  const data: Record<string, string> = {};
  const sourceFileMap: { path: string; key: string }[] = [];
  const mainSourceName = sourceFileNames[request.language];
  let wroteMainSource = false;

  for (const sourceFile of request.sourceFiles ?? []) {
    const normalizedPath = normalizeRelativePath(sourceFile.path);
    if (!normalizedPath) {
      continue;
    }

    if (normalizedPath === mainSourceName) {
      wroteMainSource = true;
    }

    const key = `source-file-${String(sourceFileMap.length)}`;
    data[key] = sourceFile.content;
    sourceFileMap.push({ path: normalizedPath, key });
  }

  if (!wroteMainSource) {
    data[mainSourceName] = request.sourceCode;
  }

  data["config.json"] = JSON.stringify(buildSandboxConfigJson(request, sourceFileMap));

  Object.assign(data, buildTestcaseConfigMapData(request));

  return data;
}

export function buildValidateConfigMapData(
  request: SandboxRequest,
  rawRuns: RawCaseRun[],
): Record<string, string> {
  const data: Record<string, string> = {};
  const validatorScript = request.judgeConfig.checkerScript ?? "";
  const validatorLanguage = request.judgeConfig.checkerLanguage === "cpp" ? "cpp" : "python";
  const ext = sourceExtension(validatorLanguage);
  data[`validator.${ext}`] = validatorScript;

  const tcByIndex = new Map(request.testcases.map((tc) => [tc.index, tc]));
  const cases: { index: number }[] = [];
  for (const run of rawRuns) {
    if (run.errorVerdict) continue;
    const tc = tcByIndex.get(run.index);
    if (tc?.output === undefined) continue;
    cases.push({ index: run.index });
    data[`case-${String(run.index)}-input.txt`] = tc.input;
    data[`case-${String(run.index)}-answer.txt`] = tc.output;
    data[`case-${String(run.index)}-team.txt`] = run.stdout;
  }

  data["config.json"] = JSON.stringify({
    submissionId: request.submissionId,
    language: request.language,
    judgeType: "checker",
    problemType: request.problemType,
    limits: request.limits,
    validate: { language: validatorLanguage, cases },
  });

  return data;
}

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
            runAsNonRoot: true,
            seccompProfile: { type: "RuntimeDefault" },
          },
          containers: [
            {
              name: "runner",
              image: params.image,
              command: ["node", "/runner/index.js"],
              resources: {
                requests: { cpu: params.cpuRequest, memory: params.memoryRequest },
                limits: { cpu: params.cpuLimit, memory: params.memoryLimit },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
                readOnlyRootFilesystem: true,
                runAsNonRoot: true,
              },
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

export const INTERACTIVE_SOCKET_PORT = 7777;

export function buildInteractiveSolutionConfigMapData(
  request: SandboxRequest,
): Record<string, string> {
  const data: Record<string, string> = {};
  const sourceFileMap: { path: string; key: string }[] = [];
  const mainSourceName = sourceFileNames[request.language];
  let wroteMainSource = false;

  for (const sourceFile of request.sourceFiles ?? []) {
    const normalizedPath = normalizeRelativePath(sourceFile.path);
    if (!normalizedPath) continue;
    if (normalizedPath === mainSourceName) wroteMainSource = true;
    const key = `source-file-${String(sourceFileMap.length)}`;
    data[key] = sourceFile.content;
    sourceFileMap.push({ path: normalizedPath, key });
  }

  if (!wroteMainSource) {
    data[mainSourceName] = request.sourceCode;
  }

  data["config.json"] = JSON.stringify({
    ...buildSandboxConfigJson(request, sourceFileMap),
    interactive: { role: "solution" },
  });

  return data;
}

export function buildInteractiveInteractorConfigMapData(
  request: SandboxRequest,
  testcase: SandboxTestcase,
): Record<string, string> {
  const interactorScript = request.judgeConfig.interactorScript ?? "";
  const checkerFallbackLanguage =
    request.judgeConfig.checkerLanguage === "cpp" ? "cpp" : "python";
  const interactorLanguage =
    request.judgeConfig.interactorLanguage === "cpp" ? "cpp" : checkerFallbackLanguage;
  const ext = sourceExtension(interactorLanguage);

  const data: Record<string, string> = {};
  data[`interactor.${ext}`] = interactorScript;
  data[`case-${String(testcase.index)}-input.txt`] = testcase.input;
  data[`case-${String(testcase.index)}-answer.txt`] = testcase.output ?? "";

  data["config.json"] = JSON.stringify({
    submissionId: request.submissionId,
    language: request.language,
    judgeType: request.judgeType,
    problemType: request.problemType,
    limits: request.limits,
    interactorLanguage,
    interactive: { role: "validator", language: interactorLanguage, index: testcase.index },
  });

  return data;
}

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
  const containerSecurityContext = {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ["ALL"] },
    readOnlyRootFilesystem: true,
    runAsNonRoot: true,
  };
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
            runAsNonRoot: true,
            seccompProfile: { type: "RuntimeDefault" },
          },
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

export const ADVANCED_INIT_NAME = "prep";
export const ADVANCED_GRADER_NAME = "grader";
export const ADVANCED_SIDECAR_NAME = "emit-result";
export const ADVANCED_RESULT_MARKER_BEGIN = "<<<NOJV_ADVANCED_RESULT>>>";
export const ADVANCED_RESULT_MARKER_END = "<<<END>>>";

const ADVANCED_WORKSPACE_SIZE_LIMIT = "1Gi";
const ADVANCED_TMP_SIZE_LIMIT = "64Mi";

export function buildAdvancedConfigMapData(request: SandboxRequest): Record<string, string> {
  const advanced = request.advanced;
  const submissionFiles: { path: string; content: string }[] = [];
  const mainSourceName = sourceFileNames[request.language];
  let wroteMain = false;

  for (const sf of request.sourceFiles ?? []) {
    const normalized = normalizeRelativePath(sf.path);
    if (!normalized) continue;
    if (normalized === mainSourceName) wroteMain = true;
    submissionFiles.push({ path: normalized, content: sf.content });
  }
  if (!wroteMain && request.sourceCode) {
    submissionFiles.push({ path: mainSourceName, content: request.sourceCode });
  }

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
          // No runAsNonRoot here — the TA grader image is trusted and may
          // need root, matching the Docker advanced path (no --user).
          securityContext: {
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

export interface K8sClientHandles {
  coreApi: k8s.CoreV1Api;
  batchApi: k8s.BatchV1Api;
}

function validatorOutcomesSeForAll(rawRuns: RawCaseRun[]): Map<number, ValidatorOutcome> {
  return new Map(
    rawRuns
      .filter((r) => !r.errorVerdict)
      .map((r): [number, ValidatorOutcome] => [r.index, { verdict: "SE" }]),
  );
}

function parseValidatorOutcomesFromLogs(
  logs: string,
  rawRuns: RawCaseRun[],
): Map<number, ValidatorOutcome> | null {
  const lines = logs.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]?.trim();
    if (!trimmed?.startsWith("{")) continue;
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parsed = parseValidateOutput(json);
    if (!parsed.success || parsed.data.validatorOutcomes === undefined) continue;

    const outcomes = new Map<number, ValidatorOutcome>();
    for (const o of parsed.data.validatorOutcomes) {
      const { index, ...rest } = o;
      outcomes.set(index, rest);
    }
    for (const r of rawRuns) {
      if (!r.errorVerdict && !outcomes.has(r.index)) {
        outcomes.set(r.index, { verdict: "SE" });
      }
    }
    return outcomes;
  }

  return null;
}

export class K8sExecutor implements SandboxExecutor {
  private readonly coreApi: k8s.CoreV1Api;
  private readonly batchApi: k8s.BatchV1Api;

  constructor(
    private readonly config: K8sExecutorConfig,
    clients?: K8sClientHandles,
  ) {
    if (clients) {
      this.coreApi = clients.coreApi;
      this.batchApi = clients.batchApi;
      return;
    }
    const k8sLib = require("@kubernetes/client-node") as typeof k8s;
    const kc = new k8sLib.KubeConfig();
    kc.loadFromCluster();
    this.coreApi = kc.makeApiClient(k8sLib.CoreV1Api);
    this.batchApi = kc.makeApiClient(k8sLib.BatchV1Api);
  }

  async execute(request: SandboxRequest): Promise<SandboxResult> {
    if (request.advanced) {
      return this.executeAdvanced(request);
    }

    if (request.judgeType === "interactive") {
      return this.executeInteractive(request);
    }

    if (request.judgeType === "checker") {
      return this.executeChecker(request);
    }

    return this.executeRunOnly(request);
  }

  private async executeAdvanced(request: SandboxRequest): Promise<SandboxResult> {
    const advanced = request.advanced;
    if (!advanced) return sandboxSystemError("advanced-mode dispatch called without payload");

    if (advanced.imageSource === "tarball") {
      const message =
        "Advanced tarball-source images require the Docker backend; push the image to a registry the cluster can pull and switch the problem to 'registry' source, or run advanced workloads on the Docker backend.";
      logger.error("K8s executor refused advanced tarball-source submission", {
        submissionId: request.submissionId,
      });
      return advancedFallbackResult(request, message);
    }

    const jobName = `judge-${request.submissionId}`;
    const ns = this.config.namespace;
    const configMapName = `${jobName}-input`;

    try {
      await this.createConfigMap(configMapName, ns, buildAdvancedConfigMapData(request));
      await this.batchApi.createNamespacedJob({
        namespace: ns,
        body: buildAdvancedJobManifest({
          jobName,
          namespace: ns,
          configMapName,
          sandboxImage: this.config.image,
          graderImage: advanced.imageRef,
          memoryMb: advanced.memoryMb,
          totalTimeMs: advanced.totalTimeMs,
          cpuLimit: this.config.cpuLimit,
          submissionId: request.submissionId,
          language: request.language,
        }),
      });

      await this.waitForJobCompletion(jobName, ns, Math.ceil(advanced.totalTimeMs / 1000) + 30);
      const podName = await this.findPodName(jobName, ns);
      if (!podName) {
        return advancedFallbackResult(request, "Advanced sandbox produced no pod.");
      }

      const sidecarLog = await this.coreApi
        .readNamespacedPodLog({
          name: podName,
          namespace: ns,
          container: ADVANCED_SIDECAR_NAME,
        })
        .catch(() => "");

      const raw = parseAdvancedResultLog(sidecarLog);
      if (raw === null) {
        return advancedFallbackResult(
          request,
          "Advanced sandbox sidecar produced no result marker.",
        );
      }

      if (raw && typeof raw === "object" && (raw as { missing?: boolean }).missing === true) {
        return advancedFallbackResult(
          request,
          "Advanced judge image did not write result.json before the deadline.",
        );
      }

      const parsed = advancedResultSchema.safeParse(raw);
      if (!parsed.success) {
        return advancedFallbackResult(
          request,
          `Invalid result.json: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
        );
      }

      return mapAdvancedResult(request, parsed.data);
    } catch (err) {
      logger.error("K8s advanced execution failed", {
        submissionId: request.submissionId,
        jobName,
        err: err instanceof Error ? err.message : String(err),
      });
      return advancedFallbackResult(
        request,
        `Advanced sandbox failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await this.cleanupJob(jobName, ns);
      await this.cleanupConfigMap(configMapName, ns);
    }
  }

  private async executeInteractive(request: SandboxRequest): Promise<SandboxResult> {
    if (!request.judgeConfig.interactorScript) {
      return sandboxSystemError("Interactive judge is missing its interactor script.");
    }

    const ns = this.config.namespace;
    const baseName = `judge-${request.submissionId}`;
    const results: SandboxTestcaseResult[] = [];

    for (const testcase of request.testcases) {
      results.push(await this.runInteractiveCase(baseName, ns, request, testcase));
    }

    return { testcaseResults: results };
  }

  private async runInteractiveCase(
    baseName: string,
    namespace: string,
    request: SandboxRequest,
    testcase: SandboxTestcase,
  ): Promise<SandboxTestcaseResult> {
    const jobName = `${baseName}-int-${String(testcase.index)}`;
    const solConfigMap = `${jobName}-sol`;
    const intConfigMap = `${jobName}-int`;

    const seCase = (message: string): SandboxTestcaseResult => ({
      index: testcase.index,
      verdict: "SE",
      stdout: "",
      stderr: message,
      exitCode: -1,
      timeMs: 0,
      score: 0,
      feedback: message,
    });

    try {
      await this.createConfigMap(
        solConfigMap,
        namespace,
        buildInteractiveSolutionConfigMapData(request),
      );
      await this.createConfigMap(
        intConfigMap,
        namespace,
        buildInteractiveInteractorConfigMapData(request, testcase),
      );

      const deadlineSeconds = Math.ceil(request.limits.timeoutMs / 1000) + 30;
      await this.batchApi.createNamespacedJob({
        namespace,
        body: buildInteractiveJobManifest({
          jobName,
          namespace,
          solutionConfigMapName: solConfigMap,
          interactorConfigMapName: intConfigMap,
          image: this.config.image,
          cpuRequest: this.config.cpuRequest,
          cpuLimit: this.config.cpuLimit,
          memoryRequest: this.config.memoryRequest,
          memoryLimit: this.config.memoryLimit,
          activeDeadlineSeconds: deadlineSeconds,
        }),
      });

      const outcome = await this.waitForJobCompletion(jobName, namespace, deadlineSeconds);
      const podName = await this.findPodName(jobName, namespace);
      if (!podName) {
        if (outcome === "failed") return seCase("Interactive sandbox job failed or timed out.");
        return seCase("Interactive sandbox produced no pod.");
      }

      const [solLogs, intLogs] = await Promise.all([
        this.coreApi
          .readNamespacedPodLog({ name: podName, namespace, container: "solution" })
          .catch(() => ""),
        this.coreApi
          .readNamespacedPodLog({ name: podName, namespace, container: "interactor" })
          .catch(() => ""),
      ]);

      const sol: InteractiveSideResult = {
        stderr: solLogs,
        timedOut: false,
        spawnError: false,
      };
      const int: InteractiveSideResult = {
        stderr: intLogs,
        timedOut: false,
        spawnError: false,
      };
      return mergeInteractiveCase(testcase, sol, int);
    } catch (err) {
      logger.error("K8s interactive case failed", {
        submissionId: request.submissionId,
        jobName,
        index: testcase.index,
        err: err instanceof Error ? err.message : String(err),
      });
      return seCase("Interactive sandbox failed to start.");
    } finally {
      await this.cleanupJob(jobName, namespace);
      await this.cleanupConfigMap(solConfigMap, namespace);
      await this.cleanupConfigMap(intConfigMap, namespace);
    }
  }

  private async cleanupJob(name: string, namespace: string): Promise<void> {
    try {
      await this.batchApi.deleteNamespacedJob({
        name,
        namespace,
        propagationPolicy: "Background",
      });
    } catch {
      // best-effort
    }
  }

  private async findPodName(jobName: string, namespace: string): Promise<string | null> {
    try {
      const pods = await this.coreApi.listNamespacedPod({
        namespace,
        labelSelector: `job-name=${jobName}`,
      });
      return pods.items[0]?.metadata?.name ?? null;
    } catch {
      return null;
    }
  }

  private async cleanupConfigMap(name: string, namespace: string): Promise<void> {
    try {
      await this.coreApi.deleteNamespacedConfigMap({ name, namespace });
    } catch {
      // best-effort
    }
  }

  private async executeRunOnly(request: SandboxRequest): Promise<SandboxResult> {
    const jobName = `judge-${request.submissionId}`;
    const ns = this.config.namespace;

    try {
      const deadlineSeconds = computeJobDeadlineSeconds(request);
      await this.createConfigMap(jobName, ns, buildRunConfigMapData(request));
      await this.createJob(jobName, ns, jobName, deadlineSeconds);

      const outcome = await this.waitForJobCompletion(jobName, ns, deadlineSeconds);
      if (outcome === "failed") {
        return sandboxSystemError("Sandbox job failed or timed out.");
      }

      const logs = await this.getPodLogs(jobName, ns);
      const parsed = this.parseRunnerOutput(logs);
      if (!parsed) return sandboxSystemError("Failed to parse sandbox runner output.", logs);
      return resolveSandboxResult(parsed, request.testcases);
    } finally {
      await this.cleanup(jobName, ns);
    }
  }

  private async executeChecker(request: SandboxRequest): Promise<SandboxResult> {
    const baseName = `judge-${request.submissionId}`;
    const validateName = `${baseName}-validate`;
    const ns = this.config.namespace;

    try {
      const deadlineSeconds = computeJobDeadlineSeconds(request);
      await this.createConfigMap(baseName, ns, buildRunConfigMapData(request));
      await this.createJob(baseName, ns, baseName, deadlineSeconds);

      const runOutcome = await this.waitForJobCompletion(baseName, ns, deadlineSeconds);
      if (runOutcome === "failed") {
        return sandboxSystemError("Sandbox job failed or timed out.");
      }

      const runLogs = await this.getPodLogs(baseName, ns);
      const runResult = this.parseRunnerOutput(runLogs);
      if (!runResult) {
        return sandboxSystemError("Failed to parse sandbox runner output.", runLogs);
      }

      if (!runResult.rawRuns) return runResult;
      const rawRuns = runResult.rawRuns;

      const hasGradableCase = rawRuns.some((r) => !r.errorVerdict);
      const outcomes = hasGradableCase
        ? await this.runValidateJob(validateName, ns, request, rawRuns)
        : new Map<number, ValidatorOutcome>();

      return { testcaseResults: mergeCheckerResults(rawRuns, outcomes) };
    } finally {
      await this.cleanup(baseName, ns);
      await this.cleanup(validateName, ns);
    }
  }

  private async runValidateJob(
    jobName: string,
    namespace: string,
    request: SandboxRequest,
    rawRuns: RawCaseRun[],
  ): Promise<Map<number, ValidatorOutcome>> {
    try {
      const deadlineSeconds = computeJobDeadlineSeconds(request);
      await this.createConfigMap(
        jobName,
        namespace,
        buildValidateConfigMapData(request, rawRuns),
      );
      await this.createJob(jobName, namespace, jobName, deadlineSeconds);

      const outcome = await this.waitForJobCompletion(jobName, namespace, deadlineSeconds);
      if (outcome === "failed") return validatorOutcomesSeForAll(rawRuns);

      const logs = await this.getPodLogs(jobName, namespace);
      return (
        parseValidatorOutcomesFromLogs(logs, rawRuns) ?? validatorOutcomesSeForAll(rawRuns)
      );
    } catch (err) {
      logger.error("K8s validate Job failed", {
        submissionId: request.submissionId,
        jobName,
        err: err instanceof Error ? err.message : String(err),
      });
      return validatorOutcomesSeForAll(rawRuns);
    }
  }

  private async createConfigMap(
    name: string,
    namespace: string,
    data: Record<string, string>,
  ): Promise<void> {
    const totalBytes = Object.entries(data).reduce(
      (sum, [key, value]) => sum + Buffer.byteLength(key) + Buffer.byteLength(value),
      0,
    );
    if (totalBytes > CONFIGMAP_MAX_BYTES) {
      throw new Error(
        `ConfigMap ${name} payload is ${String(totalBytes)} bytes, exceeding the ${String(CONFIGMAP_MAX_BYTES)}-byte limit; testcase data is too large for ConfigMap delivery.`,
      );
    }
    await this.coreApi.createNamespacedConfigMap({
      namespace,
      body: {
        metadata: { name, namespace },
        data,
      },
    });
  }

  private async createJob(
    jobName: string,
    namespace: string,
    configMapName: string,
    deadlineSeconds: number,
  ): Promise<void> {
    await this.batchApi.createNamespacedJob({
      namespace,
      body: buildSandboxJobManifest({
        jobName,
        namespace,
        configMapName,
        image: this.config.image,
        cpuRequest: this.config.cpuRequest,
        cpuLimit: this.config.cpuLimit,
        memoryRequest: this.config.memoryRequest,
        memoryLimit: this.config.memoryLimit,
        activeDeadlineSeconds: deadlineSeconds,
      }),
    });
  }

  private async waitForJobCompletion(
    jobName: string,
    namespace: string,
    deadlineSeconds: number,
  ): Promise<"succeeded" | "failed"> {
    const deadline = Date.now() + (deadlineSeconds + JOB_DEADLINE_BUFFER_SECONDS) * 1_000;

    while (Date.now() < deadline) {
      const job = await this.batchApi.readNamespacedJob({
        name: jobName,
        namespace,
      });

      if (job.status?.succeeded) return "succeeded";
      if (job.status?.failed) return "failed";

      await new Promise((r) => setTimeout(r, JOB_POLL_INTERVAL_MS));
    }

    return "failed";
  }

  private async getPodLogs(jobName: string, namespace: string): Promise<string> {
    const pods = await this.coreApi.listNamespacedPod({
      namespace,
      labelSelector: `job-name=${jobName}`,
    });

    const podName = pods.items[0]?.metadata?.name;
    if (!podName) {
      throw new Error(`No pod found for job ${jobName}`);
    }

    return this.coreApi.readNamespacedPodLog({
      container: "runner",
      name: podName,
      namespace,
    });
  }

  private parseRunnerOutput(logs: string): SandboxResult | null {
    const lines = logs.trim().split("\n");

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;

      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;

      try {
        const parsed = parseSandboxResult(JSON.parse(trimmed));
        if (parsed.success) return parsed.data;
      } catch {
        // Not valid JSON, keep searching
      }
    }

    return null;
  }

  private async cleanup(jobName: string, namespace: string): Promise<void> {
    try {
      await this.coreApi.deleteNamespacedConfigMap({
        name: jobName,
        namespace,
      });
    } catch {
      // Best-effort cleanup; ignore errors
    }

    try {
      await this.batchApi.deleteNamespacedJob({
        name: jobName,
        namespace,
        propagationPolicy: "Background",
      });
    } catch {
      // Best-effort cleanup; ignore errors
    }
  }
}
