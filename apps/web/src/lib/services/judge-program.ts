import type {
  JudgeProgramRole,
  JudgeProgramSource,
  JudgeScriptLanguage,
  SubmissionContext,
} from "@nojv/core";
import type { BuildArtifact } from "@wasm-oj/browser";
import {
  browserToolchainPercent,
  compileBrowserJudgeProgram,
  preloadBrowserToolchain,
  withPreloadRetries,
} from "./browser-local-run";

interface JudgeProgramSourceView extends JudgeProgramSource {
  sha256: string;
}

export type JudgeProgramProgress =
  { phase: "fetch" } | { phase: "toolchain"; percent: number } | { phase: "build" };

export type PreparedJudgeProgram =
  | { ok: true; role: JudgeProgramRole; language: JudgeScriptLanguage; artifact: BuildArtifact }
  | { ok: false; reason: "build_failed"; diagnostics: string }
  | { ok: false; reason: "load_failed" };

const LOAD_FAILED = { ok: false, reason: "load_failed" } as const;
const builds = new Map<string, Promise<PreparedJudgeProgram>>();

async function fetchJudgeProgram(
  problemId: string,
  context: SubmissionContext,
): Promise<JudgeProgramSourceView | null> {
  const query = new URLSearchParams({ context: JSON.stringify(context) });
  try {
    return await withPreloadRetries(async () => {
      const response = await fetch(
        `/api/problems/${encodeURIComponent(problemId)}/judge-program?${query}`,
      );
      if (response.ok) return (await response.json()) as JudgeProgramSourceView;
      if (response.status < 500 && response.status !== 429) return null;
      throw new Error(`Judge program request failed with ${String(response.status)}.`);
    });
  } catch {
    return null;
  }
}

function buildJudgeProgram(
  problemId: string,
  program: JudgeProgramSourceView,
): Promise<PreparedJudgeProgram> {
  const key = `${problemId}:${program.sha256}`;
  const cached = builds.get(key);
  if (cached) return cached;
  const build = compileBrowserJudgeProgram(problemId, program).then(
    (outcome): PreparedJudgeProgram =>
      outcome.ok
        ? {
            ok: true,
            role: program.role,
            language: program.language,
            artifact: outcome.artifact,
          }
        : { ok: false, reason: "build_failed", diagnostics: outcome.diagnostics },
    (): PreparedJudgeProgram => {
      builds.delete(key);
      return LOAD_FAILED;
    },
  );
  builds.set(key, build);
  return build;
}

export async function prepareJudgeProgram(
  { problemId, context }: { problemId: string; context: SubmissionContext },
  onProgress: (progress: JudgeProgramProgress) => void = () => undefined,
): Promise<PreparedJudgeProgram> {
  onProgress({ phase: "fetch" });
  const program = await fetchJudgeProgram(problemId, context);
  if (!program) return LOAD_FAILED;
  try {
    await preloadBrowserToolchain(program.language, (progress) =>
      onProgress({ phase: "toolchain", percent: browserToolchainPercent(progress) }),
    );
  } catch {
    return LOAD_FAILED;
  }
  onProgress({ phase: "build" });
  return buildJudgeProgram(problemId, program);
}
