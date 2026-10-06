import { beforeEach, expect, it, vi } from "vitest";
import { serialiseBuildArtifact, type JudgeType, type Language } from "@nojv/core";
import { m } from "$lib/paraglide/messages.js";
import type { BrowserCaseRun } from "$lib/services/browser-local-run";
import type { ProblemDetail } from "$lib/types";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  run: vi.fn(),
  compile: vi.fn(),
  runCases: vi.fn(),
  preload: vi.fn(),
  fetch: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("$lib/services/submission-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/services/submission-service")>()),
  executeSubmission: mocks.execute,
}));
vi.mock("$lib/services/browser-local-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/services/browser-local-run")>()),
  shouldUseBrowserLocalRun: () => true,
  runBrowserLocally: mocks.run,
  compileBrowserLocally: mocks.compile,
  runBrowserCases: mocks.runCases,
  preloadBrowserToolchain: mocks.preload,
}));
vi.mock("$lib/stores/toast", () => ({ toasts: { error: mocks.toast } }));
import { createEditorRunController } from "$lib/components/features/problem/editors/use-editor-run.svelte";

const artifact = {
  kind: "wasm" as const,
  bytes: new Uint8Array([0, 97, 115, 109]),
  language: "cpp",
  costProfile: "test-profile",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.preload.mockResolvedValue(undefined);
  mocks.compile.mockResolvedValue({ ok: true, artifact });
});

function controller(
  judgeType: JudgeType,
  options: {
    specialEnv?: boolean;
    language?: Language;
    samples?: ProblemDetail["samples"];
  } = {},
) {
  return createEditorRunController({
    problemId: "test",
    initialSamples: options.samples ?? [{ input: "", output: "42" }],
    language: () => options.language ?? "cpp",
    isWorkspaceMode: () => false,
    isSpecialEnv: () => options.specialEnv ?? false,
    judgeType: () => judgeType,
    judgeConfig: () => ({ type: judgeType }),
    timeLimitMs: 1000,
    memoryLimitMb: 128,
    drafts: () => ({
      cpp: '#include "helper.h"\nint main(){return answer();}',
      javascript: "console.log(1)",
    }),
    workspaceDrafts: () => ({}),
    workspaceFiles: () => [
      {
        language: "cpp",
        path: "main.cpp",
        content: "starter",
        visibility: "editable",
        description: "",
      },
      {
        language: "cpp",
        path: "helper.h",
        content: "int answer(){return 0;}",
        visibility: "readonly",
        description: "",
      },
      {
        language: "cpp",
        path: "private.h",
        content: "",
        visibility: "hidden",
        description: "",
      },
    ],
    context: () => ({ type: "practice" }),
  });
}

function caseRun(stdout: string, verdict: BrowserCaseRun["verdict"] = "AC"): BrowserCaseRun {
  return {
    verdict,
    stdout,
    timeMs: 3,
    memoryKb: 64,
    exitCode: verdict === "RE" ? 1 : 0,
    termination: verdict === "TLE" ? "logical-time-limit" : "exited",
  };
}

function respond(status: number, body: unknown) {
  mocks.fetch.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function postedBody(): unknown {
  const init = mocks.fetch.mock.calls[0]![1] as RequestInit;
  return JSON.parse(init.body as string);
}

const checkerSamples = [
  { input: "1 2", output: "3" },
  { input: "5 5", output: "10" },
  { input: "7", output: "7" },
];

it("custom container Test reports its browser requirement without contacting server", async () => {
  const run = controller("standard", { specialEnv: true });
  await run.run();
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
  expect(run.runError).toBe(m.editor_clientTestCustomImage());
});

it("runs standard Test with public helpers entirely in the browser even when hidden files exist", async () => {
  mocks.run.mockResolvedValue(null);
  const run = controller("standard");
  await run.run();
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.run).toHaveBeenCalledOnce();
  expect(mocks.run.mock.calls[0]![0].request.sourceFiles).toEqual([
    { path: "main.cpp", content: '#include "helper.h"\nint main(){return answer();}' },
    { path: "helper.h", content: "int answer(){return 0;}" },
  ]);
  expect(run.runSource).toBe("local");
});

it("marks standard cases without an expected output as execution-only", async () => {
  mocks.run.mockResolvedValue({
    accepted: true,
    caseResults: [
      { index: 0, verdict: "AC", timeMs: 1, stdout: "42" },
      { index: 1, verdict: "AC", timeMs: 1, stdout: "7" },
      { index: 2, verdict: "RE", timeMs: 1, stdout: "" },
    ],
    feedback: "",
    runtimeMs: 1,
    score: 100,
    verdict: "runtime_error",
  });
  const run = controller("standard");
  run.panelRunCases = [
    { input: "", expectedOutput: "42" },
    { input: "custom" },
    { input: "x" },
  ];
  await run.run();
  const cases = run.runResult?.caseResults ?? [];
  expect(cases[0]).not.toHaveProperty("executionOnly");
  expect(cases[1]).toMatchObject({ verdict: "AC", executionOnly: true });
  expect(cases[2]).not.toHaveProperty("executionOnly");
});

it("asks for a testcase before starting the browser when the problem has no samples", async () => {
  const run = controller("standard");
  run.panelRunCases = [];
  await run.run();
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
  expect(run.runError).toBe(m.editor_invalidRunCases());
});

it("waits for the language toolchain download before running and shows its progress", async () => {
  let finishDownload!: () => void;
  mocks.preload.mockImplementation(
    (
      _language: string,
      onProgress: (progress: { loadedBytes: number; totalBytes: number }) => void,
    ) =>
      new Promise<void>((resolve) => {
        onProgress({ loadedBytes: 25, totalBytes: 100 });
        finishDownload = resolve;
      }),
  );
  mocks.run.mockResolvedValue(null);
  const run = controller("standard");
  const pending = run.run();
  await vi.waitFor(() =>
    expect(mocks.preload).toHaveBeenCalledWith("cpp", expect.any(Function)),
  );
  expect(run.runStatus).toBe(m.editor_toolchainDownloading({ percent: 25 }));
  expect(mocks.run).not.toHaveBeenCalled();

  finishDownload();
  await pending;
  expect(mocks.run).toHaveBeenCalledOnce();
});

it("reports an unavailable browser toolchain without running Test or pointing to Submit", async () => {
  mocks.preload.mockRejectedValue(new Error("Failed to fetch"));
  const run = controller("standard");
  await run.run();
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(run.runError).toBe(m.editor_toolchainUnavailable());
  expect(mocks.toast).toHaveBeenCalledWith(m.editor_toolchainUnavailable());
});

it("judges only locally accepted sample cases through the checker and keeps custom cases execution-only", async () => {
  mocks.runCases.mockResolvedValue([
    caseRun("10"),
    caseRun("3"),
    caseRun("18"),
    caseRun("", "TLE"),
    caseRun("10"),
  ]);
  respond(200, { cases: [{ verdict: "WA", teamMessage: "expected 10" }, { verdict: "AC" }] });
  const run = controller("checker", { samples: checkerSamples });
  run.panelRunCases = [
    { input: "5 5", expectedOutput: "10" },
    { input: "1 2", expectedOutput: "edited" },
    { input: "9 9", expectedOutput: "not the checker answer" },
    { input: "7", expectedOutput: "7" },
    { input: "5 5" },
  ];
  await run.run();

  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.runCases.mock.calls[0]![1]).toHaveLength(5);
  expect(mocks.fetch).toHaveBeenCalledOnce();
  const [url, init] = mocks.fetch.mock.calls[0]! as [string, RequestInit];
  expect(url).toBe("/api/problems/test/test-judge");
  expect(init.method).toBe("POST");
  expect(init.headers).toMatchObject({ "X-Requested-With": "fetch" });
  expect(postedBody()).toEqual({
    kind: "checker",
    context: { type: "practice" },
    cases: [
      { sampleIndex: 1, output: "10" },
      { sampleIndex: 0, output: "3" },
    ],
  });
  expect(run.runError).toBeNull();
  expect(run.runResult?.verdict).toBe("wrong_answer");
  const cases = run.runResult?.caseResults ?? [];
  expect(cases[0]).toMatchObject({ verdict: "WA", teamMessage: "expected 10", stdout: "10" });
  expect(cases[0]).not.toHaveProperty("executionOnly");
  expect(cases[1]).toMatchObject({ verdict: "AC", stdout: "3" });
  expect(cases[1]).not.toHaveProperty("executionOnly");
  expect(cases[2]).toMatchObject({ verdict: "AC", executionOnly: true, stdout: "18" });
  expect(cases[3]).toMatchObject({ verdict: "TLE" });
  expect(cases[3]).not.toHaveProperty("executionOnly");
  expect(cases[4]).toMatchObject({ verdict: "AC", executionOnly: true });
});

it("skips the checker request when no sample case runs cleanly", async () => {
  mocks.runCases.mockResolvedValue([caseRun("", "RE"), caseRun("anything")]);
  const run = controller("checker", { samples: checkerSamples });
  run.panelRunCases = [{ input: "1 2", expectedOutput: "3" }, { input: "custom" }];
  await run.run();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(run.runResult?.verdict).toBe("runtime_error");
  expect(run.runResult?.caseResults?.[1]).toMatchObject({ verdict: "AC", executionOnly: true });
  expect(run.customCasesAllowed).toBe(true);
});

it("reports a checker compile error without running or judging", async () => {
  mocks.compile.mockResolvedValue({
    ok: false,
    result: {
      accepted: false,
      caseResults: [],
      feedback: "main.cpp:1: error",
      runtimeMs: 0,
      score: 0,
      verdict: "compile_error",
    },
  });
  const run = controller("checker", { samples: checkerSamples });
  await run.run();
  expect(mocks.runCases).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(run.runResult?.verdict).toBe("compile_error");
});

const interactiveSamples = [
  { input: "? 50", output: "<", interactorInput: "42" },
  { input: "? 1", output: "=" },
  { input: "? 7", output: "=", interactorInput: "7" },
];

it("judges interactive samples with an interactor input on the server with the compiled program", async () => {
  respond(200, {
    cases: [
      {
        verdict: "AC",
        transcript: { toInteractor: "? 50\n? 42\n", toContestant: "<\n=\n" },
        timeMs: 12,
      },
      { verdict: "WA", teamMessage: "too many guesses", contestantStderr: "debug" },
    ],
  });
  const run = controller("interactive", { samples: interactiveSamples });
  expect(run.panelRunCases).toEqual([{ input: "42" }, { input: "7" }]);
  expect(run.customCasesAllowed).toBe(false);
  run.panelRunCases = [...run.panelRunCases, { input: "custom interactor input" }];
  await run.run();

  expect(mocks.runCases).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
  expect(postedBody()).toEqual({
    kind: "interactive",
    context: { type: "practice" },
    language: "cpp",
    artifact: JSON.parse(JSON.stringify(serialiseBuildArtifact(artifact))),
    cases: [{ sampleIndex: 0 }, { sampleIndex: 2 }],
  });
  expect(run.runResult?.verdict).toBe("wrong_answer");
  expect(run.runResult?.caseResults).toEqual([
    {
      index: 0,
      verdict: "AC",
      timeMs: 12,
      transcript: { toInteractor: "? 50\n? 42\n", toContestant: "<\n=\n" },
    },
    { index: 1, verdict: "WA", timeMs: 0, stderr: "debug", teamMessage: "too many guesses" },
  ]);
});

it.each(["javascript", "typescript"] as const)(
  "blocks a %s interactive contestant before compiling",
  async (language) => {
    const run = controller("interactive", { language, samples: interactiveSamples });
    await run.run();
    expect(mocks.preload).not.toHaveBeenCalled();
    expect(mocks.compile).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(run.runError).toBe(m.editor_testInteractiveLanguage());
  },
);

it("explains that an interactive problem without interactor inputs has nothing to test", async () => {
  const run = controller("interactive", { samples: [{ input: "? 1", output: "=" }] });
  expect(run.panelRunCases).toEqual([]);
  await run.run();
  expect(mocks.compile).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(run.runError).toBe(m.editor_testNoInteractiveSamples());
});

it.each([
  [429, "test_judge_busy", () => m.editor_testJudgeBusy(), false],
  [503, "test_judge_busy", () => m.editor_testJudgeBusy(), false],
  [503, "test_judge_unavailable", () => m.editor_testUnavailableForProblem(), false],
  [409, "judge_program_build_failed", () => m.editor_testJudgeProgramBuildFailed(), true],
  [409, "judge_program_unsupported", () => m.editor_testUnavailableForProblem(), true],
  [400, "test_rejected", () => m.editor_runFailed(), false],
] as const)(
  "maps a %i %s response to its Test message",
  async (status, code, message, disablesTest) => {
    mocks.runCases.mockResolvedValue([caseRun("3")]);
    respond(status, { code, message: code });
    const run = controller("checker", { samples: checkerSamples });
    await run.run();
    expect(run.runError).toBe(message());
    expect(mocks.toast).toHaveBeenCalledWith(message());
    expect(run.testDisabledReason).toBe(disablesTest ? message() : null);
  },
);

it("treats an uncoded test-judge failure as a generic Test failure", async () => {
  mocks.runCases.mockResolvedValue([caseRun("3")]);
  respond(429, { message: "Too many requests" });
  const run = controller("checker", { samples: checkerSamples });
  await run.run();
  expect(run.runError).toBe(m.editor_runFailed());
  expect(run.testDisabledReason).toBeNull();
});
