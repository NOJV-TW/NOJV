import { execFile } from "node:child_process";

import {
  effectiveTimeLimitMs,
  type AdvancedConfig,
  type Language,
  type SandboxRequest,
  type SandboxResult,
  type SandboxTestcase,
} from "@nojv/core";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildSeedProblemDefs,
  type SeedProblemDef,
} from "../../../packages/db/prisma/seeds/problems.js";
import { enforceMemoryLimit } from "../../../apps/worker/src/services/check-standard.js";
import { DockerExecutor } from "../../../apps/worker/src/services/docker-executor.js";
import { SEED_SOLUTIONS } from "./seed-solutions.js";

const SANDBOX_IMAGE = "nojv-sandbox:local";
const DEMO_RUN_IMAGE = "registry.nojv.tw/demo/nojv-demo-advanced-run:main";
const DEMO_GRADE_IMAGE = "registry.nojv.tw/demo/nojv-demo-advanced-grade:main";

const EXECUTOR = new DockerExecutor({
  cpuLimit: "2.0",
  image: SANDBOX_IMAGE,
  memoryMb: 512,
  pidsLimit: 128,
});

function execute(request: SandboxRequest) {
  return EXECUTOR.execute(request, {
    runId: request.submissionId,
    signal: new AbortController().signal,
  });
}

const SEED_DEFS = buildSeedProblemDefs("seed_smoke_teacher");

const PER_PROBLEM_TIMEOUT_MS = 300_000;

function run(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15_000 }, (err, stdout) => {
      resolve({ ok: !err, stdout: stdout.toString() });
    });
  });
}

async function imagePresent(ref: string): Promise<boolean> {
  const { ok, stdout } = await run("docker", ["images", "-q", ref]);
  return ok && stdout.trim().length > 0;
}

let unavailableReason: string | null = "not initialised";

beforeAll(async () => {
  if (!(await run("docker", ["info"])).ok) {
    unavailableReason = "docker daemon unreachable";
    return;
  }
  const missing: string[] = [];
  if (!(await imagePresent(SANDBOX_IMAGE))) missing.push(SANDBOX_IMAGE);
  if (!(await imagePresent(DEMO_RUN_IMAGE))) missing.push(DEMO_RUN_IMAGE);
  if (!(await imagePresent(DEMO_GRADE_IMAGE))) missing.push(DEMO_GRADE_IMAGE);
  if (missing.length > 0) {
    unavailableReason = `missing images: ${missing.join(", ")}`;
    return;
  }
  unavailableReason = null;
}, 60_000);

function skipUnlessReady(ctx: { skip: () => void }): boolean {
  if (unavailableReason === null) return false;
  if (process.env.REQUIRE_SEED_SMOKE === "1") {
    throw new Error(
      `seed Docker smoke required (REQUIRE_SEED_SMOKE=1) but ${unavailableReason} — run \`pnpm sandbox:build && pnpm demo-advanced:build\` first.`,
    );
  }
  // eslint-disable-next-line no-console
  console.warn(`[seed-docker-smoke] skipping: ${unavailableReason}`);
  ctx.skip();
  return true;
}

function defFor(id: string): SeedProblemDef {
  const def = SEED_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`seed problem not found: ${id}`);
  return def;
}

function seedTestcases(def: SeedProblemDef): SandboxTestcase[] {
  if (!def.testcases) return [];
  const all = [
    ...def.testcases.sample.cases,
    ...def.testcases.hidden.cases,
    ...(def.testcases.hidden2?.cases ?? []),
  ];
  return all.map((tc, index) => ({
    index,
    input: tc.input,
    output: tc.output,
    weight: 1,
    isSample: false,
  }));
}

function judgeTypeFor(def: SeedProblemDef): SandboxRequest["judgeType"] {
  const t = def.judgeConfig?.type;
  if (t === "checker") return "checker";
  if (t === "interactive") return "interactive";
  return "standard";
}

function judgeConfigFor(def: SeedProblemDef): SandboxRequest["judgeConfig"] {
  const cfg = def.judgeConfig;
  if (!cfg) return {};
  const out: SandboxRequest["judgeConfig"] = {};
  if (typeof cfg.checkerScript === "string") out.checkerScript = cfg.checkerScript;
  if (typeof cfg.interactorScript === "string") out.interactorScript = cfg.interactorScript;
  if (typeof cfg.checkerLanguage === "string") out.checkerLanguage = cfg.checkerLanguage;
  if (typeof cfg.interactorLanguage === "string")
    out.interactorLanguage = cfg.interactorLanguage;
  return out;
}

function mergeMultiFileSources(
  def: SeedProblemDef,
  language: Language,
  editable: { path: string; content: string }[],
): { sourceFiles: { path: string; content: string }[]; entryFile: string } {
  const merged = new Map<string, string>();
  for (const wf of def.workspaceFiles ?? []) {
    if (wf.language === language) merged.set(wf.path, wf.content);
  }
  const editablePaths = new Set(
    (def.workspaceFiles ?? [])
      .filter((wf) => wf.language === language && wf.visibility === "editable")
      .map((wf) => wf.path),
  );
  for (const f of editable) {
    if (editablePaths.has(f.path)) merged.set(f.path, f.content);
  }
  return {
    sourceFiles: Array.from(merged.entries()).map(([path, content]) => ({ path, content })),
    entryFile: "main.py",
  };
}

type Variant = "correct" | "wrong";

function buildRequest(def: SeedProblemDef, variant: Variant): SandboxRequest {
  const solution = SEED_SOLUTIONS[def.id];
  if (!solution) throw new Error(`no seed solution fixture for ${def.id}`);
  const language = solution.language;
  const side = solution[variant];

  const limits = {
    timeoutMs: effectiveTimeLimitMs(def.timeLimitMs, language),
    memoryMb: def.memoryLimitMb,
  };

  if (def.type === "special_env") {
    const advanced = def.advancedConfig as AdvancedConfig;
    const main = side.sourceFiles?.[0]?.content ?? side.sourceCode ?? "";
    return {
      submissionId: `seed-${def.id}-${variant}-${Date.now()}`,
      sourceCode: "",
      sourceFiles: [{ path: "main.py", content: main }],
      entryFile: "main.py",
      language,
      problemType: "special_env",
      testcases: [],
      judgeType: "standard",
      judgeConfig: {},
      limits,
      advanced: {
        run: advanced.run,
        grade: advanced.grade,
        network: advanced.network,
        totalTimeMs: 60_000,
        memoryMb: def.memoryLimitMb,
        maxScore: advanced.maxScore,
      },
    };
  }

  const base = {
    submissionId: `seed-${def.id}-${variant}-${Date.now()}`,
    language,
    testcases: seedTestcases(def),
    judgeType: judgeTypeFor(def),
    judgeConfig: judgeConfigFor(def),
    limits,
  };

  if (def.type === "multi_file") {
    const editable = side.sourceFiles ?? [];
    const { sourceFiles, entryFile } = mergeMultiFileSources(def, language, editable);
    return {
      ...base,
      sourceCode: "",
      sourceFiles,
      entryFile,
      problemType: "multi_file",
    };
  }

  return {
    ...base,
    sourceCode: side.sourceCode ?? "",
    problemType: "full_source",
  };
}

function applyMemoryEnforcement(def: SeedProblemDef, result: SandboxResult): SandboxResult {
  if (def.type === "special_env" || result.testcaseResults.length === 0) return result;
  return {
    ...result,
    testcaseResults: enforceMemoryLimit(result.testcaseResults, def.memoryLimitMb),
  };
}

async function judge(def: SeedProblemDef, variant: Variant): Promise<SandboxResult> {
  const raw = await execute(buildRequest(def, variant));
  return applyMemoryEnforcement(def, raw);
}

function verdicts(result: SandboxResult): string[] {
  return result.testcaseResults.map((r) => r.verdict);
}

describe("seed Docker smoke — every problem judges correctly", () => {
  for (const def of SEED_DEFS) {
    const solution = SEED_SOLUTIONS[def.id];
    const label = `${def.id} [${def.type}/${judgeTypeFor(def)}]`;

    it(
      `${label} — correct → AC, wrong → ${solution?.wrong.expectVerdict ?? "?"}`,
      { timeout: PER_PROBLEM_TIMEOUT_MS },
      async (ctx) => {
        if (skipUnlessReady(ctx)) return;

        const correct = await judge(def, "correct");
        expect(correct.compilationError, `${label} correct compile`).toBeUndefined();
        expect(correct.pipelineError, `${label} correct pipeline`).toBeUndefined();
        expect(correct.testcaseResults.length, `${label} correct case count`).toBeGreaterThan(
          0,
        );
        expect(verdicts(correct), `${label} correct verdicts`).toEqual(
          correct.testcaseResults.map(() => "AC"),
        );
        if (def.type === "special_env") {
          expect(correct.customScore, `${label} correct score`).toBe(100);
        }

        const wrong = await judge(def, "wrong");
        const expected = SEED_SOLUTIONS[def.id]!.wrong.expectVerdict;
        expect(wrong.compilationError, `${label} wrong compile`).toBeUndefined();
        expect(wrong.pipelineError, `${label} wrong pipeline`).toBeUndefined();
        expect(
          verdicts(wrong).some((v) => v === expected),
          `${label} wrong should hit ${expected}, got ${verdicts(wrong).join(",")}`,
        ).toBe(true);
        expect(verdicts(wrong), `${label} wrong must not all-AC`).not.toEqual(
          wrong.testcaseResults.map(() => "AC"),
        );
      },
    );
  }
});

const PROBE_PROBLEM_ID = "problem_warmup-sum";

function probeRequest(
  id: string,
  source: { language: Language; sourceCode: string },
  memoryMb?: number,
): SandboxRequest {
  const def = defFor(PROBE_PROBLEM_ID);
  return {
    submissionId: `probe-${id}-${Date.now()}`,
    sourceCode: source.sourceCode,
    language: source.language,
    problemType: "full_source",
    testcases: seedTestcases(def),
    judgeType: "standard",
    judgeConfig: {},
    limits: {
      timeoutMs: effectiveTimeLimitMs(def.timeLimitMs, source.language),
      memoryMb: memoryMb ?? def.memoryLimitMb,
    },
  };
}

async function probe(
  id: string,
  source: { language: Language; sourceCode: string },
  memoryMb?: number,
): Promise<SandboxResult> {
  const raw = await execute(probeRequest(id, source, memoryMb));
  const def = defFor(PROBE_PROBLEM_ID);
  return {
    ...raw,
    testcaseResults: enforceMemoryLimit(raw.testcaseResults, memoryMb ?? def.memoryLimitMb),
  };
}

const AC_SOURCE = `a, b = map(int, input().split())
print(a + b)
`;
const WA_SOURCE = `a, b = map(int, input().split())
print(a - b)
`;
const TLE_SOURCE = `while True:
    pass
`;
const MLE_SOURCE = `import sys
blocks = []
while True:
    blocks.append(bytearray(64 * 1024 * 1024))
`;
const RE_SOURCE = `a, b = map(int, input().split())
raise SystemExit(1)
`;
const CE_SOURCE = `int main() {
    syntax error here
}
`;

describe("seed Docker smoke — every verdict type appears", () => {
  it("AC: correct solution", { timeout: PER_PROBLEM_TIMEOUT_MS }, async (ctx) => {
    if (skipUnlessReady(ctx)) return;
    const result = await probe("ac", { language: "python", sourceCode: AC_SOURCE });
    expect(result.compilationError).toBeUndefined();
    expect(verdicts(result).every((v) => v === "AC")).toBe(true);
  });

  it("WA: wrong output", { timeout: PER_PROBLEM_TIMEOUT_MS }, async (ctx) => {
    if (skipUnlessReady(ctx)) return;
    const result = await probe("wa", { language: "python", sourceCode: WA_SOURCE });
    expect(result.compilationError).toBeUndefined();
    expect(verdicts(result).some((v) => v === "WA")).toBe(true);
  });

  it("TLE: infinite loop", { timeout: PER_PROBLEM_TIMEOUT_MS }, async (ctx) => {
    if (skipUnlessReady(ctx)) return;
    const result = await probe("tle", { language: "python", sourceCode: TLE_SOURCE });
    expect(result.compilationError).toBeUndefined();
    expect(verdicts(result).some((v) => v === "TLE")).toBe(true);
  });

  it("MLE: allocate beyond limit", { timeout: PER_PROBLEM_TIMEOUT_MS }, async (ctx) => {
    if (skipUnlessReady(ctx)) return;
    const result = await probe("mle", { language: "python", sourceCode: MLE_SOURCE }, 128);
    expect(result.compilationError).toBeUndefined();
    expect(verdicts(result).some((v) => v === "MLE")).toBe(true);
  });

  it("RE: non-zero exit", { timeout: PER_PROBLEM_TIMEOUT_MS }, async (ctx) => {
    if (skipUnlessReady(ctx)) return;
    const result = await probe("re", { language: "python", sourceCode: RE_SOURCE });
    expect(result.compilationError).toBeUndefined();
    expect(verdicts(result).some((v) => v === "RE")).toBe(true);
  });

  it("CE: C++ syntax error", { timeout: PER_PROBLEM_TIMEOUT_MS }, async (ctx) => {
    if (skipUnlessReady(ctx)) return;
    const result = await probe("ce", { language: "cpp", sourceCode: CE_SOURCE });
    expect(result.compilationError, "expected a compile error message").toBeTruthy();
    expect(result.testcaseResults.length).toBe(0);
  });
});
