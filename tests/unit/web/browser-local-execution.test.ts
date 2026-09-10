import { expect, it, vi } from "vitest";
import { runBrowserLocally } from "$lib/services/browser-local-run";

const engine = vi.hoisted(() => ({
  compile: vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({
    success: true,
    artifact: { id: "compiled", costProfile: "test-profile" },
  }),
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
    { id: "compiled", costProfile: "test-profile" },
    expect.objectContaining({
      stdin: "(())",
      env: { MODE: "strict" },
      resources: expect.objectContaining({
        logicalTimeLimitMs: 750,
        memoryLimitBytes: 64 * 1024 * 1024,
        outputLimitBytes: 16 * 1024 * 1024,
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
        { id: "compiled", costProfile: "test-profile" },
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

it.each(["compile", "run"] as const)(
  "discards a completed %s result after cancellation and does not start another case",
  async (phase) => {
    const controller = new AbortController();
    const runsBefore = engine.run.mock.calls.length;
    const cancellationsBefore = engine.cancel.mock.calls.length;
    engine[phase].mockImplementationOnce(async () => {
      controller.abort();
      return phase === "compile"
        ? { success: true, artifact: { id: "compiled", costProfile: "test-profile" } }
        : {
            termination: "exited",
            code: 0,
            stdout: "YES",
            stderr: "",
            durationMs: 1,
            metrics: { logicalTimeNs: 1, memoryBytes: 1024 },
          };
    });
    const result = await runBrowserLocally({
      request: {
        context: { type: "practice" },
        language: "c",
        problemId: "cancelled",
        sourceCode: "source",
      },
      cases: [{ input: "first" }, { input: "second" }],
      judgeConfig: { type: "standard" },
      problemId: "cancelled",
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      signal: controller.signal,
    });
    expect(result).toBeNull();
    expect(engine.run.mock.calls.length - runsBefore).toBe(phase === "compile" ? 0 : 1);
    expect(engine.cancel.mock.calls.length - cancellationsBefore).toBe(1);
  },
);

it("keeps short C wall limits aligned with the native 2x grace, without a browser-only floor", async () => {
  await runBrowserLocally({
    request: {
      context: { type: "practice" },
      language: "c",
      problemId: "short",
      sourceCode: "int main(){}",
    },
    cases: [{ input: "" }],
    judgeConfig: { type: "standard" },
    problemId: "short",
    timeLimitMs: 100,
    memoryLimitMb: 128,
    signal: new AbortController().signal,
  });
  expect(engine.run).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({
      resources: expect.objectContaining({ logicalTimeLimitMs: 100 }),
    }),
  );
});

it("leaves the clock, instruction budget and host safety deadline to Forge defaults", async () => {
  const costProfile = "java-profile";
  engine.compile.mockResolvedValueOnce({
    success: true,
    artifact: { id: "java", costProfile },
  });
  await runBrowserLocally({
    request: {
      context: { type: "practice" },
      language: "java",
      problemId: "fuel",
      sourceCode: "class Main {}",
    },
    cases: [{ input: "" }],
    judgeConfig: { type: "standard" },
    problemId: "fuel",
    timeLimitMs: 1000,
    memoryLimitMb: 128,
    signal: new AbortController().signal,
  });
  const config = engine.run.mock.calls.at(-1)?.[1] as Record<string, unknown>;
  expect(config).not.toHaveProperty("determinism");
  expect(config.resources).not.toHaveProperty("instructionBudget");
  expect(config.resources).not.toHaveProperty("wallTimeLimitMs");
});
