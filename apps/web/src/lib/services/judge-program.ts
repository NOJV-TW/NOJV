import {
  judgeProgramSourceViewSchema,
  type JudgeProgramRole,
  type JudgeProgramSourceView,
  type JudgeScriptLanguage,
  type SubmissionContext,
} from "@nojv/core";
import type { BuildArtifact } from "@wasm-oj/browser";
import {
  browserToolchainPercent,
  compileBrowserJudgeProgram,
  preloadBrowserToolchain,
  withPreloadRetries,
} from "./browser-local-run";

export type JudgeProgramProgress =
  { phase: "fetch" } | { phase: "toolchain"; percent: number } | { phase: "build" };

export type PreparedJudgeProgram =
  | { ok: true; role: JudgeProgramRole; language: JudgeScriptLanguage; artifact: BuildArtifact }
  | { ok: false; reason: "build_failed"; diagnostics: string }
  | { ok: false; reason: "load_failed" | "unavailable" };

type JudgeProgramFailure = Extract<PreparedJudgeProgram, { reason: string }>;

const LOAD_FAILED = { ok: false, reason: "load_failed" } as const;
const UNAVAILABLE = { ok: false, reason: "unavailable" } as const;
const builds = new Map<string, Promise<PreparedJudgeProgram>>();

async function fetchJudgeProgram(
  problemId: string,
  context: SubmissionContext,
): Promise<JudgeProgramSourceView | JudgeProgramFailure> {
  const query = new URLSearchParams({ context: JSON.stringify(context) });
  try {
    return await withPreloadRetries(async () => {
      const response = await fetch(
        `/api/problems/${encodeURIComponent(problemId)}/judge-program?${query}`,
      );
      if (response.ok) return judgeProgramSourceViewSchema.parse(await response.json());
      const failure = `Judge program request failed with ${String(response.status)}.`;
      if (response.status === 403 || response.status === 404) {
        console.warn(failure);
        return UNAVAILABLE;
      }
      if (response.status < 500 && response.status !== 429) {
        console.warn(failure);
        return LOAD_FAILED;
      }
      throw new Error(failure);
    });
  } catch (error) {
    console.warn("Couldn't load the judge program.", error);
    return LOAD_FAILED;
  }
}

function buildJudgeProgram(
  problemId: string,
  program: JudgeProgramSourceView,
): Promise<PreparedJudgeProgram> {
  const key = `${problemId}:${program.language}:${program.sha256}`;
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
    (error: unknown): PreparedJudgeProgram => {
      console.warn("Couldn't build the judge program.", error);
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
  if ("ok" in program) return program;
  try {
    await preloadBrowserToolchain(program.language, (progress) =>
      onProgress({ phase: "toolchain", percent: browserToolchainPercent(progress) }),
    );
  } catch (error) {
    console.warn("Couldn't load the judge program's toolchain.", error);
    return LOAD_FAILED;
  }
  onProgress({ phase: "build" });
  return buildJudgeProgram(problemId, program);
}
