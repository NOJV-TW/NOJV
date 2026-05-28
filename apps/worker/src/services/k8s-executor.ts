import { createRequire } from "node:module";

import type * as k8s from "@kubernetes/client-node";

const require = createRequire(import.meta.url);

import {
  normalizeRelativePath,
  sourceFileNames,
  type RawCaseRun,
  type SandboxExecutor,
  type SandboxRequest,
  type SandboxResult,
  type ValidatorOutcome,
} from "@nojv/core";
import { createLogger } from "../logger.js";
import { mergeCheckerResults, resolveSandboxResult } from "./check-standard";
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

export class K8sExecutor implements SandboxExecutor {
  private coreApi: k8s.CoreV1Api;
  private batchApi: k8s.BatchV1Api;

  constructor(private config: K8sExecutorConfig) {
    // Lazy-import avoids loading @kubernetes/client-node when DockerExecutor is used (local dev).
    const k8sLib = require("@kubernetes/client-node") as typeof k8s;
    const kc = new k8sLib.KubeConfig();
    kc.loadFromCluster();
    this.coreApi = kc.makeApiClient(k8sLib.CoreV1Api);
    this.batchApi = kc.makeApiClient(k8sLib.BatchV1Api);
  }

  async execute(request: SandboxRequest): Promise<SandboxResult> {
    // Advanced Mode requires loading a TA-supplied tarball into a local
    // Docker daemon (see AdvancedModeExecutor); the K8s executor has no
    // path for that. Fail fast with a neutral learner-facing message;
    // operator-facing detail goes to the worker log.
    if (request.advanced) {
      logger.error("K8s executor refused advanced-mode submission — switch to Docker backend", {
        submissionId: request.submissionId,
      });
      return sandboxSystemError(
        "Sandbox configuration error. Please contact your administrator.",
      );
    }

    // Interactive mode requires a live cross-container stdio pipe between the
    // solution and interactor containers (Phase 2C), proxied by the worker.
    // That is not feasible through the K8s Job API — fail fast instead of
    // grading incorrectly. Operator-facing detail goes to the worker log.
    if (request.judgeType === "interactive") {
      logger.error("K8s executor refused interactive submission — switch to Docker backend", {
        submissionId: request.submissionId,
      });
      return sandboxSystemError(
        "Sandbox configuration error. Please contact your administrator.",
      );
    }

    if (request.judgeType === "checker") {
      return this.executeChecker(request);
    }

    return this.executeRunOnly(request);
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
