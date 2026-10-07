import { beforeEach, expect, it, vi } from "vitest";
import type { JudgeType, Language } from "@nojv/core";
import { m } from "$lib/paraglide/messages.js";
import type { ProblemDetail } from "$lib/types";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  run: vi.fn(),
  preload: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("$lib/services/submission-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/services/submission-service")>()),
  executeSubmission: mocks.execute,
}));
vi.mock("$lib/services/browser-local-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/services/browser-local-run")>()),
  runBrowserLocally: mocks.run,
  preloadBrowserToolchain: mocks.preload,
}));
vi.mock("$lib/stores/toast", () => ({ toasts: { error: mocks.toast } }));
import { createEditorRunController } from "$lib/components/features/problem/editors/use-editor-run.svelte";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preload.mockResolvedValue(undefined);
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

const interactiveSamples = [
  { input: "? 50", output: "<", interactorInput: "42" },
  { input: "? 1", output: "=" },
  { input: "? 7", output: "=", interactorInput: "7" },
];

it.each([
  ["checker", checkerSamples],
  ["interactive", interactiveSamples],
] as const)(
  "reports %s Test as unavailable and disables it without compiling",
  async (judgeType, samples) => {
    const run = controller(judgeType, { samples });
    await run.run();
    expect(mocks.preload).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(run.runResult).toBeNull();
    expect(run.runError).toBe(m.editor_testUnavailableForProblem());
    expect(mocks.toast).toHaveBeenCalledWith(m.editor_testUnavailableForProblem());
    expect(run.testDisabledReason).toBe(m.editor_testUnavailableForProblem());
  },
);

it("starts interactive cases from the samples' interactor inputs and allows no custom cases", () => {
  const run = controller("interactive", { samples: interactiveSamples });
  expect(run.panelRunCases).toEqual([{ input: "42" }, { input: "7" }]);
  expect(run.customCasesAllowed).toBe(false);
  expect(controller("checker", { samples: checkerSamples }).customCasesAllowed).toBe(true);
});

it("ignores a second Test press while one is running", async () => {
  let finish!: (result: null) => void;
  mocks.run.mockReturnValueOnce(new Promise<null>((resolve) => (finish = resolve)));
  const run = controller("standard");
  const first = run.run();
  await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());
  await run.run();
  finish(null);
  await first;
  expect(mocks.run).toHaveBeenCalledOnce();
});
