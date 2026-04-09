import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { ScoringConfig } from "@nojv/core";
import type { SandboxTestcaseResult } from "../types.js";
import { compileChecker } from "../compiler.js";
import { runProcess } from "../judges/run-process.js";

export interface ScoringInput {
  submissionId: string;
  language: string;
  rawScore: number;
  testcaseResults: SandboxTestcaseResult[];
  submittedAt: string;
}

export interface ScoringOutput {
  finalScore: number;
  feedback?: string;
}

/**
 * Run a custom scoring script.
 *
 * The script receives a JSON object on stdin with:
 * - submissionId, language, rawScore, testcaseResults, submittedAt
 *
 * It must print a JSON object to stdout with:
 * - finalScore (number 0-100)
 * - feedback (optional string)
 */
export async function runCustomScoring(
  config: ScoringConfig,
  input: ScoringInput
): Promise<ScoringOutput> {
  if (!config.script) {
    return {
      finalScore: input.rawScore,
      feedback: "Scoring config has no script defined."
    };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scoring-"));

  try {
    // Write the scoring script to disk
    const ext =
      config.language === "python" || config.language === "python3"
        ? ".py"
        : `.${config.language}`;
    const scriptPath = path.join(tmpDir, `scoring${ext}`);
    await fs.writeFile(scriptPath, config.script, "utf-8");

    // Compile if needed
    const lang = config.language === "python3" ? "python" : config.language;
    const compileResult = await compileChecker(scriptPath, lang, tmpDir, "scoring");

    if (!compileResult.success) {
      return {
        finalScore: input.rawScore,
        feedback: `Scoring script compilation failed: ${compileResult.error}`
      };
    }

    // Run the scoring script with the input JSON on stdin
    const inputJson = JSON.stringify(input);
    const result = await runProcess(compileResult.runCommand, {
      stdin: inputJson,
      timeoutMs: config.timeoutMs
    });

    if (result.spawnError) {
      return {
        finalScore: input.rawScore,
        feedback: `Scoring script failed to start: ${result.stderr}`
      };
    }

    if (result.timedOut) {
      return {
        finalScore: input.rawScore,
        feedback: "Scoring script timed out."
      };
    }

    if (result.exitCode !== 0) {
      return {
        finalScore: input.rawScore,
        feedback: `Scoring script exited with code ${String(result.exitCode)}: ${result.stderr}`
      };
    }

    // Parse the scoring script output
    const output = result.stdout.trim();
    try {
      const parsed = JSON.parse(output) as { finalScore?: number; feedback?: string };
      const finalScore =
        typeof parsed.finalScore === "number"
          ? Math.max(0, Math.min(100, Math.round(parsed.finalScore)))
          : input.rawScore;

      return {
        finalScore,
        ...(typeof parsed.feedback === "string" ? { feedback: parsed.feedback } : {})
      };
    } catch {
      // If the output is just a number, treat it as the score
      const num = parseFloat(output);
      if (Number.isFinite(num)) {
        return { finalScore: Math.max(0, Math.min(100, Math.round(num))) };
      }
      return {
        finalScore: input.rawScore,
        feedback: `Scoring script output is not valid JSON or number: ${output.slice(0, 200)}`
      };
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
