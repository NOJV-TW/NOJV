import { expect, it, vi } from "vitest";
import { runBrowserLocally } from "$lib/services/browser-local-run";

const engine = vi.hoisted(() => ({
  compile: vi
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue({ success: true, artifact: { id: "compiled" } }),
  run: vi.fn().mockResolvedValue({
    termination: "exited",
    code: 0,
    stdout: "YES",
    stderr: "",
    durationMs: 1,
    metrics: { logicalTimeNs: 1, memoryBytes: 1024 },
  }),
  cancel: vi.fn(),
}));
vi.mock("../../../apps/web/node_modules/@wasm-oj/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../apps/web/node_modules/@wasm-oj/browser")>()),
  createBrowserEngine: vi.fn().mockResolvedValue(engine),
}));

it("passes Standard Mode stdin and configured runtime to the browser engine", async () => {
  const result = await runBrowserLocally({
    request: {
      context: { type: "practice" },
      language: "python",
      problemId: "brackets",
      sourceCode: "print('YES')",
    },
    cases: [{ input: "(())", expectedOutput: "yes" }],
    judgeConfig: {
      type: "standard",
      compare: { caseSensitive: false },
      runtime: { timeLimitMs: 250, memoryLimitMb: 64, env: { MODE: "strict" } },
    },
    problemId: "brackets",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    signal: new AbortController().signal,
  });
  expect(result?.feedback).toBe("Local browser run completed.");
  expect(engine.run).toHaveBeenCalledWith(
    { id: "compiled" },
    expect.objectContaining({
      stdin: "(())",
      env: { MODE: "strict" },
      resources: expect.objectContaining({
        logicalTimeLimitMs: 750,
        memoryLimitBytes: 64 * 1024 * 1024,
      }),
    }),
  );
  expect(result?.verdict).toBe("accepted");
});

it.each(["", "a", "a\n", "a\r\n", "a\n\n", " \t"])(
  "preserves exact custom input %j across languages",
  async (input) => {
    for (const language of [
      "c",
      "cpp",
      "go",
      "java",
      "javascript",
      "python",
      "rust",
      "typescript",
    ] as const) {
      await runBrowserLocally({
        request: {
          context: { type: "practice" },
          language,
          problemId: "exact-input",
          sourceCode: "source",
        },
        cases: [{ input }],
        judgeConfig: { type: "standard" },
        problemId: "exact-input",
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        signal: new AbortController().signal,
      });
      expect(engine.run).toHaveBeenLastCalledWith(
        { id: "compiled" },
        expect.objectContaining({ stdin: input }),
      );
    }
  },
);

it("does not report acceptance when no testcase is provided", async () => {
  const result = await runBrowserLocally({
    request: {
      context: { type: "practice" },
      language: "c",
      problemId: "empty",
      sourceCode: "source",
    },
    cases: [],
    judgeConfig: { type: "standard" },
    problemId: "empty",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    signal: new AbortController().signal,
  });
  expect(result).toMatchObject({ accepted: false, verdict: "system_error", caseResults: [] });
});

it("distinguishes engine failures from compilation rejection", async () => {
  engine.run.mockRejectedValueOnce(new Error("Worker crashed"));
  const args = {
    request: {
      context: { type: "practice" as const },
      language: "c" as const,
      problemId: "failure",
      sourceCode: "source",
    },
    cases: [{ input: "" }],
    judgeConfig: { type: "standard" as const },
    problemId: "failure",
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    signal: new AbortController().signal,
  };
  expect(await runBrowserLocally(args)).toMatchObject({ verdict: "system_error" });
  engine.compile.mockResolvedValueOnce({
    success: false,
    stderr: "syntax error",
    stdout: "",
    diagnostics: [],
  });
  expect(await runBrowserLocally(args)).toMatchObject({ verdict: "compile_error" });
});
