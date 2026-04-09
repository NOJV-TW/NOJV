/**
 * Advanced-mode runner: dispatches to a TA-provided judge container that
 * implements the advanced container contract:
 *
 *   /workspace/submission/   - Student source files (read-only for the judge)
 *   /workspace/testcases/N/  - Per-testcase data (input.txt, expected.txt, *)
 *   /workspace/meta.json     - Submission metadata (language, limits, ...)
 *   /workspace/output/       - Judge writes result.json here
 *
 * After the container exits, this module reads `/workspace/output/result.json`,
 * validates it against `advancedResultSchema`, and maps it into the standard
 * `SandboxResult` shape so downstream consumers (worker, domain, web UI) need
 * no special handling.
 *
 * NOTE: Actually spawning the docker container from inside the sandbox-runner
 * requires host docker socket access, which is intentionally NOT mounted in
 * the standard sandbox image. The full host-side dispatch lives in
 * `apps/worker/src/services/docker-executor.ts` (or a future advanced-mode
 * executor). This module focuses on workspace preparation, contract parsing,
 * and result mapping; the actual `docker run` invocation is stubbed with
 * TODO markers below.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  advancedResultSchema,
  type AdvancedResult,
  type SandboxResult,
  type SandboxTestcaseResult,
  type SandboxVerdict
} from "@nojv/core";

import type { SandboxInput } from "./types.js";

const log = (message: string): void => {
  process.stderr.write(`[advanced-mode] ${message}\n`);
};

interface AdvancedModeOutcome {
  /** Optional human-readable error to surface to the caller. */
  error?: string;
  /** Sandbox result mapped from the TA container's result.json. */
  result: SandboxResult;
}

/**
 * Top-level entry point used by `index.ts` when `config.advanced` is set.
 */
export async function runAdvancedMode(config: SandboxInput): Promise<SandboxResult> {
  if (!config.advanced) {
    return systemError("runAdvancedMode called without advanced config");
  }

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "advanced-mode-"));
  try {
    log(`Preparing workspace at ${workspace}`);
    await prepareWorkspace(config, workspace);
    const outcome = await invokeTaContainer(config, workspace);
    return outcome.result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Fatal error: ${message}`);
    return systemError(`Advanced-mode execution failed: ${message}`);
  } finally {
    await fs.rm(workspace, { force: true, recursive: true }).catch(() => undefined);
  }
}

// ─── Workspace preparation ──────────────────────────────────────────────

async function prepareWorkspace(config: SandboxInput, workspace: string): Promise<void> {
  const submissionDir = path.join(workspace, "submission");
  const testcasesDir = path.join(workspace, "testcases");
  const outputDir = path.join(workspace, "output");

  await fs.mkdir(submissionDir, { recursive: true });
  await fs.mkdir(testcasesDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  // 1. Materialize submission files. We support both `sourceFiles` (inline)
  //    and `sourceFileMap` (paths from /submission). Inline always wins.
  const written = new Set<string>();
  for (const file of config.sourceFiles ?? []) {
    const target = path.join(submissionDir, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, "utf-8");
    written.add(file.path);
  }

  // 2. Materialize per-testcase files (sandbox runner reads testcases from
  //    /submission/testcases/*; we re-emit them under /workspace/testcases/*).
  const baseTestcasesDir = path.join("/submission", "testcases");
  let testcaseDirs: string[] = [];
  try {
    const entries = await fs.readdir(baseTestcasesDir, { withFileTypes: true });
    testcaseDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  } catch {
    // No on-disk testcases — we'll fall back to advanced.testcaseFiles only.
  }

  for (const dir of testcaseDirs) {
    const src = path.join(baseTestcasesDir, dir);
    const dst = path.join(testcasesDir, dir);
    await fs.mkdir(dst, { recursive: true });
    const files = await fs.readdir(src);
    for (const fileName of files) {
      const data = await fs.readFile(path.join(src, fileName));
      await fs.writeFile(path.join(dst, fileName), data);
    }
  }

  for (const [indexStr, files] of Object.entries(config.advanced?.testcaseFiles ?? {})) {
    const dst = path.join(testcasesDir, indexStr);
    await fs.mkdir(dst, { recursive: true });
    for (const [relativePath, content] of Object.entries(files)) {
      const target = path.join(dst, relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf-8");
    }
  }

  // 3. Write meta.json — the contract surface visible to the TA's judge.
  const meta = {
    submissionId: config.submissionId,
    language: config.language,
    submissionType: config.submissionType,
    limits: config.limits,
    advanced: {
      totalTimeMs: config.advanced!.totalTimeMs,
      memoryMb: config.advanced!.memoryMb,
      networkEnabled: config.advanced!.networkEnabled
    }
  };
  await fs.writeFile(path.join(workspace, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
}

// ─── TA container dispatch ──────────────────────────────────────────────

async function invokeTaContainer(
  config: SandboxInput,
  workspace: string
): Promise<AdvancedModeOutcome> {
  const advanced = config.advanced!;

  // TODO(phase-7-followup): Spawning the TA container from inside the
  // sandbox-runner is intentionally not implemented yet. The current sandbox
  // image does not mount the docker socket, so we either need a sidecar
  // executor or a host-level worker that handles advanced-mode submissions
  // separately. The skeleton below shows the intended invocation shape; for
  // now we attempt the spawn and gracefully fall back to "result.json
  // missing" handling, which yields a clean SE verdict.
  const dockerArgs = [
    "run",
    "--rm",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,exec,nosuid,nodev,size=64m",
    "-v",
    `${workspace}:/workspace`,
    "--cpus",
    "1.0",
    "--memory",
    `${String(advanced.memoryMb)}m`,
    "--network",
    advanced.networkEnabled ? "bridge" : "none",
    advanced.imageRef
  ];

  log(`Would invoke: docker ${dockerArgs.join(" ")}`);

  // TODO(phase-7-followup): When `imageSource === "tarball"`, the worker
  // first needs to `docker load -i <tarball>` before run. The tarball is
  // expected to be staged at /submission/judge-image.tar (passed via the
  // SubmissionJudgeContext's storage layer).

  await runDockerStub(dockerArgs, advanced.totalTimeMs).catch((err) => {
    log(`Docker spawn stubbed/failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  const resultPath = path.join(workspace, "output", "result.json");
  const advancedResult = await readAndValidateResult(resultPath);
  if (!advancedResult) {
    return {
      result: systemError(
        "Advanced judge did not produce a valid /workspace/output/result.json"
      )
    };
  }

  return { result: mapAdvancedResult(advancedResult) };
}

/**
 * Stubbed `docker run` invocation. Resolves silently if `docker` is missing
 * (the common case inside the sandbox image), so the rest of the pipeline
 * can still attempt to read the contract output and respond gracefully.
 */
async function runDockerStub(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn("docker", args, { stdio: "ignore" });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs + 5_000);

    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });

    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
  });
}

// ─── Result parsing & mapping ───────────────────────────────────────────

async function readAndValidateResult(resultPath: string): Promise<AdvancedResult | null> {
  let raw: string;
  try {
    raw = await fs.readFile(resultPath, "utf-8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const validation = advancedResultSchema.safeParse(parsed);
  if (!validation.success) {
    log(`result.json failed validation: ${validation.error.message}`);
    return null;
  }
  return validation.data;
}

const verdictMap: Record<AdvancedResult["verdict"], SandboxVerdict> = {
  accepted: "AC",
  wrong_answer: "WA",
  time_limit_exceeded: "TLE",
  memory_limit_exceeded: "MLE",
  runtime_error: "RE",
  compile_error: "RE"
};

function mapAdvancedResult(advanced: AdvancedResult): SandboxResult {
  const overallVerdict = verdictMap[advanced.verdict] ?? "SE";

  // Prefer the per-testcase array if the judge supplied it; otherwise emit
  // a single synthetic case so the rest of the pipeline can compute scores.
  let testcaseResults: SandboxTestcaseResult[];

  if (advanced.testcases && advanced.testcases.length > 0) {
    testcaseResults = advanced.testcases.map((tc) => ({
      index: tc.index,
      verdict: tc.verdict,
      stdout: "",
      stderr: "",
      exitCode: 0,
      timeMs: tc.runtimeMs ?? 0,
      score: tc.verdict === "AC" ? 1 : 0,
      ...(tc.feedback ? { feedback: tc.feedback } : {})
    }));
  } else {
    testcaseResults = [
      {
        index: 0,
        verdict: overallVerdict,
        stdout: "",
        stderr: "",
        exitCode: 0,
        timeMs: 0,
        score: advanced.score / 100,
        ...(advanced.feedback ? { feedback: advanced.feedback } : {})
      }
    ];
  }

  return {
    testcaseResults,
    customScore: advanced.score,
    ...(advanced.feedback ? { scoringFeedback: advanced.feedback } : {})
  };
}

function systemError(message: string): SandboxResult {
  return {
    testcaseResults: [
      {
        index: 0,
        verdict: "SE",
        stdout: "",
        stderr: message,
        exitCode: -1,
        timeMs: 0,
        feedback: message
      }
    ]
  };
}
