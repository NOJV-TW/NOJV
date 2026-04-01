import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  CustomScriptRunAt,
  CustomScriptStage,
  CustomScriptStageResult
} from "@nojv/core";
import { compileChecker } from "../compiler.js";
import { runProcess } from "../judges/run-process.js";

export interface CustomScriptContext {
  submissionId: string;
  language: string;
  judgeType: string;
  workDir: string;
  sourcePath: string;
  rawScore?: number;
  testcaseResults?: unknown[];
}

export async function runCustomScriptStage(
  stage: CustomScriptStage,
  runAt: CustomScriptRunAt,
  context: CustomScriptContext
): Promise<CustomScriptStageResult> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "custom-stage-"));

  try {
    const scriptExt = extensionForLanguage(stage.config.language);
    const scriptPath = path.join(tmpDir, `${stage.name}${scriptExt}`);
    await fs.writeFile(scriptPath, stage.config.script, "utf-8");

    const compileResult = await compileChecker(scriptPath, stage.config.language, tmpDir, stage.name);
    if (!compileResult.success) {
      return {
        name: stage.name,
        runAt,
        passed: false,
        exitCode: -1,
        timedOut: false,
        feedback: `Compilation failed: ${compileResult.error}`
      };
    }

    const payload = {
      submissionId: context.submissionId,
      language: context.language,
      judgeType: context.judgeType,
      runAt,
      stageName: stage.name,
      workDir: context.workDir,
      sourcePath: context.sourcePath,
      rawScore: context.rawScore,
      testcaseResults: context.testcaseResults
    };

    const result = await runProcess(compileResult.runCommand, {
      stdin: JSON.stringify(payload),
      timeoutMs: stage.config.timeoutMs
    });

    const parsed = parseStageOutput(result.stdout, result.stderr);
    const passed =
      typeof parsed.passed === "boolean"
        ? parsed.passed
        : !result.timedOut && !result.spawnError && result.exitCode === 0;

    return {
      name: stage.name,
      runAt,
      passed,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      ...(parsed.feedback ? { feedback: parsed.feedback } : {}),
      ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {})
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch((cleanupError: unknown) => {
      void cleanupError;
    });
  }
}

function extensionForLanguage(language: string): string {
  switch (language) {
    case "python":
    case "python3":
      return ".py";
    case "c":
      return ".c";
    case "cpp":
      return ".cpp";
    case "go":
      return ".go";
    case "rust":
      return ".rs";
    default:
      return ".py";
  }
}

function parseStageOutput(stdout: string, stderr: string): {
  passed?: boolean;
  feedback?: string;
  metadata?: unknown;
} {
  const preferred = stdout.trim() || stderr.trim();
  if (!preferred) {
    return {};
  }

  try {
    const parsed = JSON.parse(preferred) as {
      passed?: boolean;
      feedback?: string;
      metadata?: unknown;
      message?: string;
    };

    const feedback =
      typeof parsed.feedback === "string"
        ? parsed.feedback
        : typeof parsed.message === "string"
          ? parsed.message
          : undefined;

    return {
      ...(typeof parsed.passed === "boolean" ? { passed: parsed.passed } : {}),
      ...(feedback ? { feedback } : {}),
      ...(Object.prototype.hasOwnProperty.call(parsed, "metadata")
        ? { metadata: parsed.metadata }
        : {})
    };
  } catch {
    return { feedback: preferred.slice(0, 1000) };
  }
}
