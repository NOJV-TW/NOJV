import { afterEach, beforeEach, expect, it, vi } from "vitest";

type JudgeProgramService = typeof import("$lib/services/judge-program");
type CompileInput = { language: string; entry: string; files: Record<string, string> };
type PrefetchOptions = {
  language: string;
  onProgress?: (progress: { loadedBytes: number; totalBytes: number }) => void;
};

const fakes = vi.hoisted(() => ({
  engine: {
    compile: vi.fn<(input: CompileInput, options: unknown) => Promise<unknown>>(),
    cancel: vi.fn(),
  },
  prefetch: vi.fn<(sources: readonly unknown[], options: PrefetchOptions) => Promise<void>>(),
  fetch: vi.fn<(url: string) => Promise<Response>>(),
}));
vi.mock("../../../apps/web/node_modules/@wasm-oj/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../apps/web/node_modules/@wasm-oj/browser")>()),
  createBrowserEngine: vi.fn().mockResolvedValue(fakes.engine),
  prefetchBrowserToolchain: fakes.prefetch,
}));

const pythonChecker = {
  role: "checker",
  language: "python",
  source: "accept()\n",
  sha256: "a".repeat(64),
};
const cppChecker = {
  role: "checker",
  language: "cpp",
  source: "#include <bits/stdc++.h>\nint main() { return 42; }\n",
  sha256: "b".repeat(64),
};
const context = { type: "practice" } as const;

function respondWith(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

let service: JudgeProgramService;

beforeEach(async () => {
  vi.resetModules();
  fakes.engine.compile.mockReset().mockResolvedValue({
    success: true,
    artifact: { id: "checker-artifact" },
    diagnostics: [],
    stdout: "",
    stderr: "",
  });
  fakes.prefetch.mockReset().mockResolvedValue(undefined);
  fakes.fetch.mockReset().mockImplementation(async () => respondWith(pythonChecker));
  vi.stubGlobal("fetch", fakes.fetch);
  service = await import("$lib/services/judge-program");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("fetches a Python checker for its context and packages it with the DOMjudge wrapper", async () => {
  const progress: unknown[] = [];

  const prepared = await service.prepareJudgeProgram({ problemId: "p1", context }, (update) =>
    progress.push(update),
  );

  expect(prepared).toEqual({
    ok: true,
    role: "checker",
    language: "python",
    artifact: { id: "checker-artifact" },
  });
  expect(fakes.fetch).toHaveBeenCalledWith(
    `/api/problems/p1/judge-program?${new URLSearchParams({ context: JSON.stringify(context) })}`,
  );
  expect(fakes.prefetch.mock.calls[0]![1]).toMatchObject({ language: "python" });
  const [input, options] = fakes.engine.compile.mock.calls[0]!;
  expect(input).toMatchObject({ language: "python", entry: "main.py", target: "wasip1" });
  expect(Object.keys(input.files)).toEqual(["main.py"]);
  expect(input.files["main.py"]).toMatch(/sys\.argv/);
  expect(input.files["main.py"]!.endsWith(pythonChecker.source)).toBe(true);
  expect(options).toEqual({ cache: true });
  expect(progress).toEqual([{ phase: "fetch" }, { phase: "build" }]);
});

it("compiles a C++ checker with the libc++ PCH shim and reports its toolchain download", async () => {
  fakes.fetch.mockImplementation(async () => respondWith(cppChecker));
  fakes.prefetch.mockImplementation(async (_sources, { onProgress }) => {
    onProgress?.({ loadedBytes: 25, totalBytes: 100 });
  });
  const progress: unknown[] = [];

  const prepared = await service.prepareJudgeProgram({ problemId: "p1", context }, (update) =>
    progress.push(update),
  );

  expect(prepared).toMatchObject({ ok: true, language: "cpp" });
  expect(fakes.prefetch.mock.calls[0]![1]).toMatchObject({
    language: "cpp",
    libcxxPrecompiledHeader: true,
  });
  const [input] = fakes.engine.compile.mock.calls[0]!;
  expect(input).toMatchObject({ language: "cpp", entry: "main.cpp" });
  expect(input.files["main.cpp"]).toBe(cppChecker.source);
  expect(Object.keys(input.files)).toEqual(
    expect.arrayContaining(["src/bits/stdc++.h", "wasm-oj.pch.hpp"]),
  );
  expect(progress).toEqual([
    { phase: "fetch" },
    { phase: "toolchain", percent: 25 },
    { phase: "build" },
  ]);
});

it("returns the compiler output when the checker fails to build", async () => {
  fakes.fetch.mockImplementation(async () => respondWith(cppChecker));
  fakes.engine.compile.mockResolvedValue({
    success: false,
    diagnostics: [],
    stdout: "",
    stderr: "main.cpp:2:1: error: expected ';'",
  });

  await expect(service.prepareJudgeProgram({ problemId: "p1", context })).resolves.toEqual({
    ok: false,
    reason: "build_failed",
    diagnostics: "main.cpp:2:1: error: expected ';'",
  });
});

it("refetches the source on every preparation but builds each digest once", async () => {
  await service.prepareJudgeProgram({ problemId: "p1", context });
  await service.prepareJudgeProgram({ problemId: "p1", context });

  expect(fakes.fetch).toHaveBeenCalledTimes(2);
  expect(fakes.engine.compile).toHaveBeenCalledOnce();
});

it("rebuilds when the source's digest changes", async () => {
  await service.prepareJudgeProgram({ problemId: "p1", context });
  fakes.fetch.mockImplementation(async () =>
    respondWith({ ...pythonChecker, source: "reject()\n", sha256: "c".repeat(64) }),
  );
  await service.prepareJudgeProgram({ problemId: "p1", context });

  expect(fakes.engine.compile).toHaveBeenCalledTimes(2);
  expect(fakes.engine.compile.mock.calls[1]![0].files["main.py"]!.endsWith("reject()\n")).toBe(
    true,
  );
});

it("retries a failing source request before reporting a load failure", async () => {
  vi.useFakeTimers();
  fakes.fetch.mockImplementation(async () => respondWith({}, 503));

  const pending = service.prepareJudgeProgram({ problemId: "p1", context });
  await vi.advanceTimersByTimeAsync(7_000);

  await expect(pending).resolves.toEqual({ ok: false, reason: "load_failed" });
  expect(fakes.fetch).toHaveBeenCalledTimes(3);
  expect(fakes.engine.compile).not.toHaveBeenCalled();
});

it("reports a refused source request as a load failure without retrying", async () => {
  fakes.fetch.mockImplementation(async () => respondWith({ message: "Not found" }, 404));

  await expect(service.prepareJudgeProgram({ problemId: "p1", context })).resolves.toEqual({
    ok: false,
    reason: "load_failed",
  });
  expect(fakes.fetch).toHaveBeenCalledOnce();
});

it("reports an engine failure as a load failure and builds again next time", async () => {
  fakes.engine.compile.mockRejectedValueOnce(new Error("Failed to fetch"));

  await expect(service.prepareJudgeProgram({ problemId: "p1", context })).resolves.toEqual({
    ok: false,
    reason: "load_failed",
  });
  await expect(
    service.prepareJudgeProgram({ problemId: "p1", context }),
  ).resolves.toMatchObject({ ok: true });
  expect(fakes.engine.compile).toHaveBeenCalledTimes(2);
});
