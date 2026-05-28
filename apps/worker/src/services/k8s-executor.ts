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

const JOB_DEADLINE_SECONDS = 120;
const JOB_POLL_INTERVAL_MS = 1_000;
const TTL_AFTER_FINISHED_SECONDS = 60;

/**
 * Build the flat testcase ConfigMap keys. Standard and checker both decide
 * AC/WA off-pod (worker comparison; isolated validator Job), so the expected
 * answer must never reach the sandbox run pod. Interactive is gated to Docker
 * upstream and never reaches here.
 */
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

/**
 * Build the flat ConfigMap `data` for the run Job. Includes the student
 * source + config.json + testcase inputs. For checker, the validator script
 * is NOT shipped here — it goes into a SEPARATE validate Job (see
 * `buildValidateConfigMapData`) so the run pod sees neither answer nor
 * validator.
 */
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

/**
 * Build the flat ConfigMap `data` for the validate Job. Contains the
 * validator source, a config.json carrying the `validate` block, and
 * per-case input/answer/team files keyed flat (ConfigMaps cannot hold nested
 * directories). Cases whose run errored or whose testcase has no expected
 * answer are skipped — the worker-side merge marks them appropriately.
 */
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
}

/**
 * Build the K8s Job manifest for a sandbox pod. Used for BOTH the run pod
 * and the validate pod so they get identical hardening (drop caps, read-only
 * fs, non-root, RuntimeDefault seccomp, no service account, sandbox node
 * pool + toleration, NetworkPolicy label).
 */
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
      activeDeadlineSeconds: JOB_DEADLINE_SECONDS,
      backoffLimit: 0,
      template: {
        // The `app: nojv-sandbox` label here (NOT on the Job metadata) is
        // what the sandbox NetworkPolicy podSelector matches — Job labels
        // do not propagate to the pod template.
        metadata: {
          labels: { app: "nojv-sandbox", "nojv-role": "sandbox" },
        },
        spec: {
          restartPolicy: "Never",
          automountServiceAccountToken: false,
          // Sandbox pods only land on the untrusted-code node pool, which
          // is tainted `nojv-role=sandbox:NoSchedule` so nothing else runs
          // there. Keeps a runaway fork-bomb from starving the orchestrator.
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

/**
 * Localhost TCP port used by the in-pod socat pair to bridge the solution and
 * interactor containers' stdio. Unprivileged (>= 1024) so the non-root sandbox
 * user can bind it; the pod has `--network=none` semantics via NetworkPolicy,
 * so this port is never exposed outside the pod's network namespace.
 */
export const INTERACTIVE_SOCKET_PORT = 7777;

/**
 * Build the solution container's ConfigMap data. Contains ONLY the student
 * source + a config.json marking the runner as the solution side. NO testcase
 * input, NO expected answer, NO interactor script — those live in a SEPARATE
 * ConfigMap mounted ONLY into the interactor container.
 */
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

/**
 * Build the interactor container's ConfigMap data for ONE case. Contains the
 * interactor script + that case's secret input/answer (under flat
 * `case-{i}-input.txt` / `case-{i}-answer.txt` keys — ConfigMaps cannot hold
 * nested directories) + a config.json marking the runner as the validator
 * side. NEVER contains the student source.
 */
export function buildInteractiveInteractorConfigMapData(
  request: SandboxRequest,
  testcase: SandboxTestcase,
): Record<string, string> {
  const interactorScript = request.judgeConfig.interactorScript ?? "";
  const interactorLanguage =
    request.judgeConfig.interactorLanguage === "cpp"
      ? "cpp"
      : request.judgeConfig.checkerLanguage === "cpp"
        ? "cpp"
        : "python";
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

/**
 * Solution-side socat wrapper. Connects to the interactor's TCP listener on
 * localhost and execs the sandbox runner — the runner's fd 0/1 become the
 * socket end, so its existing `stdio: ["inherit","inherit","pipe"]` spawn just
 * pipes student-program stdio across the pod-internal connection. Retries up to
 * 40 × 0.25 s = 10 s to absorb the listener's startup race.
 */
export function buildSolutionContainerCommand(): string[] {
  return [
    "sh",
    "-c",
    `exec socat EXEC:"node /runner/index.js" TCP:127.0.0.1:${String(INTERACTIVE_SOCKET_PORT)},retry=40,interval=0.25`,
  ];
}

/**
 * Interactor-side socat wrapper. LISTENs on the shared port (reuseaddr so
 * a stuck socket from a previous case never wedges retries) and execs the
 * runner on each connection.
 */
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

/**
 * Build the K8s Job manifest for one interactive testcase. The pod has TWO
 * containers (`solution` + `interactor`) sharing a network namespace but with
 * DISTINCT per-container `volumeMounts` — the secret input/answer/interactor
 * ConfigMap is mounted ONLY into the interactor container, never into the
 * solution container's filesystem. Same hardening profile as the standard run
 * pod (drop caps, read-only fs, non-root, RuntimeDefault seccomp, no service
 * account, sandbox node pool + toleration, NetworkPolicy label).
 */
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

/**
 * Advanced Mode on K8s — registry-source only.
 *
 * The TA grader image lives in a registry the cluster can pull. The grader
 * reads `/workspace/submission/` + `/workspace/meta.json` and writes
 * `/workspace/output/result.json` (same contract as the Docker advanced
 * executor). Since K8s has no host bind mount, the worker can't read the
 * result file directly — a SIDECAR container tails it and emits the JSON
 * inside marker lines to its stdout, which the worker reads via pod logs.
 *
 * Pod layout (requires K8s ≥ 1.28 for native sidecars):
 *   initContainers:
 *     - prep (sandbox image): seeds /workspace from a ConfigMap-mounted payload
 *     - emit-result (sandbox image, restartPolicy: Always): polls + emits
 *   containers:
 *     - grader (TA's registry image): the actual judge
 */
export const ADVANCED_INIT_NAME = "prep";
export const ADVANCED_GRADER_NAME = "grader";
export const ADVANCED_SIDECAR_NAME = "emit-result";
export const ADVANCED_RESULT_MARKER_BEGIN = "<<<NOJV_ADVANCED_RESULT>>>";
export const ADVANCED_RESULT_MARKER_END = "<<<END>>>";

const ADVANCED_WORKSPACE_SIZE_LIMIT = "1Gi";
const ADVANCED_TMP_SIZE_LIMIT = "64Mi";

/**
 * Pack everything the prep init container needs to seed /workspace into a
 * single JSON blob keyed `payload.json`. ConfigMaps can't hold nested
 * directories, so the init script reconstructs the layout from this blob
 * instead of relying on per-file keys.
 */
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

/**
 * Shell script for the prep initContainer. Reads the packed payload from the
 * read-only ConfigMap mount and lays out /workspace per the advanced
 * contract. /workspace/output is chmod 0777 so the TA image (with its own
 * user) can write result.json regardless of uid.
 */
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

/**
 * Shell script for the emit-result native sidecar. Polls for the grader's
 * result.json until either the file appears or a deadline elapses (derived
 * from totalTimeMs + headroom). Emits the JSON inside marker lines so the
 * worker can extract the result reliably from interleaved pod logs.
 */
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

/**
 * Extract the JSON payload between the BEGIN/END markers in a sidecar log.
 * Returns null when markers are missing or the payload isn't valid JSON.
 */
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

/**
 * Build the K8s Job manifest for an advanced-mode registry-source
 * submission. Uses the K8s 1.28+ native sidecar pattern: the emit-result
 * container is declared in `initContainers` with `restartPolicy: Always`
 * so it runs alongside the grader and K8s terminates it after the grader
 * exits — at which point the tail script's deadline-bounded loop has either
 * already cat'd result.json or will emit the {"missing":true} sentinel.
 */
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

export class K8sExecutor implements SandboxExecutor {
  private coreApi: k8s.CoreV1Api;
  private batchApi: k8s.BatchV1Api;

  constructor(
    private config: K8sExecutorConfig,
    clients?: K8sClientHandles,
  ) {
    if (clients) {
      // Test-only injection seam — production callers omit `clients` and we
      // load from the in-cluster kubeconfig below.
      this.coreApi = clients.coreApi;
      this.batchApi = clients.batchApi;
      return;
    }
    // Lazy-import avoids loading @kubernetes/client-node when DockerExecutor is used (local dev).
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

  /**
   * Advanced Mode on K8s. Tarball-source images can't be loaded ad-hoc into
   * a cluster (no Docker daemon), so we fail-fast with a clear operator
   * message. Registry-source images are dispatched via the init+grader+
   * sidecar pattern; result.json is transported through the sidecar's stdout.
   * Requires K8s ≥ 1.28 for the native sidecar (initContainer w/
   * restartPolicy: Always) semantics.
   */
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

      await this.waitForJobCompletion(jobName, ns);
      // Even if the Job is reported failed, the sidecar may have flushed a
      // result (or the {missing:true} sentinel); read its log either way.
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

  /**
   * Interactive flow on K8s: one Job per case, each Job's pod has a
   * `solution` + `interactor` container sharing a network namespace. The
   * containers bridge stdio over a localhost TCP socket via socat. The secret
   * input/answer reaches the interactor container's filesystem ONLY (via a
   * dedicated ConfigMap); the solution container never has it mounted. After
   * both containers exit, the worker reads each container's logs separately,
   * parses the marker lines, and merges per-case via `mergeInteractiveCase` —
   * the same function the Docker backend uses.
   */
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

      const outcome = await this.waitForJobCompletion(jobName, namespace);
      // We always try to read logs, regardless of Job status: an interactive
      // pod's Job-level state is misleading because the solution-side socat
      // exits non-zero with "broken pipe" the moment the interactor's socat
      // closes the TCP connection — making EVERY successful interactive run
      // look like a "failed" Job to K8s. The authoritative signal is the
      // marker the sandbox runner writes on its container's stderr BEFORE
      // socat tears down: if both markers are present, mergeInteractiveCase
      // returns the real verdict; if either is missing, it returns SE.
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
      await this.createConfigMap(jobName, ns, buildRunConfigMapData(request));
      await this.createJob(jobName, ns, jobName);

      const outcome = await this.waitForJobCompletion(jobName, ns);
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

  /**
   * Checker flow on K8s: a TWO-Job pipeline (run pod → validate pod). The run
   * pod sees neither the expected answer nor the validator script; the
   * validate pod sees neither the student source nor the run pod's working
   * directory. Per-case files reach the validate pod via a flat ConfigMap.
   * Final verdicts come from `mergeCheckerResults` (same merge the Docker
   * backend uses).
   */
  private async executeChecker(request: SandboxRequest): Promise<SandboxResult> {
    const baseName = `judge-${request.submissionId}`;
    const validateName = `${baseName}-validate`;
    const ns = this.config.namespace;

    try {
      await this.createConfigMap(baseName, ns, buildRunConfigMapData(request));
      await this.createJob(baseName, ns, baseName);

      const runOutcome = await this.waitForJobCompletion(baseName, ns);
      if (runOutcome === "failed") {
        return sandboxSystemError("Sandbox job failed or timed out.");
      }

      const runLogs = await this.getPodLogs(baseName, ns);
      const runResult = this.parseRunnerOutput(runLogs);
      if (!runResult) {
        return sandboxSystemError("Failed to parse sandbox runner output.", runLogs);
      }

      // Compile error / pipeline error short-circuit: no rawRuns to validate.
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

  /**
   * Run the validate Job and return per-case outcomes. Any Job/log/parse
   * failure becomes an SE for every requested case (mirrors `runValidator` in
   * the Docker path).
   */
  private async runValidateJob(
    jobName: string,
    namespace: string,
    request: SandboxRequest,
    rawRuns: RawCaseRun[],
  ): Promise<Map<number, ValidatorOutcome>> {
    const seForAll = (): Map<number, ValidatorOutcome> =>
      new Map(
        rawRuns
          .filter((r) => !r.errorVerdict)
          .map((r): [number, ValidatorOutcome] => [r.index, { verdict: "SE" }]),
      );

    try {
      await this.createConfigMap(
        jobName,
        namespace,
        buildValidateConfigMapData(request, rawRuns),
      );
      await this.createJob(jobName, namespace, jobName);

      const outcome = await this.waitForJobCompletion(jobName, namespace);
      if (outcome === "failed") return seForAll();

      const logs = await this.getPodLogs(jobName, namespace);
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

      return seForAll();
    } catch (err) {
      logger.error("K8s validate Job failed", {
        submissionId: request.submissionId,
        jobName,
        err: err instanceof Error ? err.message : String(err),
      });
      return seForAll();
    }
  }

  private async createConfigMap(
    name: string,
    namespace: string,
    data: Record<string, string>,
  ): Promise<void> {
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
      }),
    });
  }

  private async waitForJobCompletion(
    jobName: string,
    namespace: string,
  ): Promise<"succeeded" | "failed"> {
    const deadline = Date.now() + JOB_DEADLINE_SECONDS * 1_000;

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
    // The sandbox runner writes a single JSON object to stdout as its
    // last output. Find the last line that looks like JSON.
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
    // Delete ConfigMap; Job auto-cleans via ttlSecondsAfterFinished.
    try {
      await this.coreApi.deleteNamespacedConfigMap({
        name: jobName,
        namespace,
      });
    } catch {
      // Best-effort cleanup; ignore errors
    }

    // Also attempt to delete the Job in case TTL controller is slow
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
