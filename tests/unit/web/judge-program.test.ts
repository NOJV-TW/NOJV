import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareJudgeProgram } from "$lib/services/judge-program";

type CompileInput = {
  language: string;
  entry: string;
  files: Record<string, string>;
  projectId: string;
};

const fakes = vi.hoisted(() => ({
  engine: {
    compile: vi.fn<(input: CompileInput, options: unknown) => Promise<unknown>>(),
    cancel: vi.fn(),
  },
  preload:
    vi.fn<
      (
        language: string,
        onProgress: (progress: { loadedBytes: number; totalBytes: number }) => void,
      ) => Promise<void>
    >(),
  fetch: vi.fn<(url: string) => Promise<Response>>(),
  warn: vi.fn(),
}));
vi.mock("../../../apps/web/node_modules/@wasm-oj/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../apps/web/node_modules/@wasm-oj/browser")>()),
  createBrowserEngine: vi.fn().mockResolvedValue(fakes.engine),
}));
vi.mock("$lib/services/browser-local-run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/services/browser-local-run")>()),
  preloadBrowserToolchain: fakes.preload,
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
const signal = new AbortController().signal;
const built = {
  success: true,
  artifact: { id: "checker-artifact" },
  diagnostics: [],
  stdout: "",
  stderr: "",
};

function respondWith(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  fakes.engine.compile.mockReset().mockResolvedValue(built);
  fakes.engine.cancel.mockReset();
  fakes.preload.mockReset().mockResolvedValue(undefined);
  fakes.fetch.mockReset().mockImplementation(async () => respondWith(pythonChecker));
  fakes.warn.mockReset();
  vi.stubGlobal("fetch", fakes.fetch);
  vi.spyOn(console, "warn").mockImplementation(fakes.warn);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("fetches a Python checker for its context and packages it with the DOMjudge wrapper", async () => {
  const progress: unknown[] = [];

  const prepared = await prepareJudgeProgram(
    { problemId: "python-1", context, signal },
    (update) => progress.push(update),
  );

  expect(prepared).toEqual({
    ok: true,
    role: "checker",
    language: "python",
    artifact: { id: "checker-artifact" },
  });
  expect(fakes.fetch).toHaveBeenCalledWith(
    `/api/problems/python-1/judge-program?${new URLSearchParams({ context: JSON.stringify(context) })}`,
  );
  expect(fakes.preload).toHaveBeenCalledWith("python", expect.any(Function));
  const [input, options] = fakes.engine.compile.mock.calls[0]!;
  expect(input).toMatchObject({
    language: "python",
    entry: "main.py",
    target: "wasip1",
    projectId: "nojv-judge-program-v1-python-1-checker-python",
  });
  expect(Object.keys(input.files)).toEqual(["main.py"]);
  expect(input.files["main.py"]).toMatch(/sys\.argv/);
  expect(input.files["main.py"]!.endsWith(pythonChecker.source)).toBe(true);
  expect(options).toEqual({ cache: true });
  expect(progress).toEqual([{ phase: "fetch" }, { phase: "build" }]);
});

it("compiles a C++ checker with the libc++ PCH shim and reports its toolchain download", async () => {
  fakes.fetch.mockImplementation(async () => respondWith(cppChecker));
  fakes.preload.mockImplementation(async (_language, onProgress) => {
    onProgress({ loadedBytes: 25, totalBytes: 100 });
  });
  const progress: unknown[] = [];

  const prepared = await prepareJudgeProgram(
    { problemId: "cpp-1", context, signal },
    (update) => progress.push(update),
  );

  expect(prepared).toMatchObject({ ok: true, language: "cpp" });
  expect(fakes.preload).toHaveBeenCalledWith("cpp", expect.any(Function));
  const [input] = fakes.engine.compile.mock.calls[0]!;
  expect(input).toMatchObject({
    language: "cpp",
    entry: "main.cpp",
    projectId: "nojv-judge-program-v1-cpp-1-checker-cpp",
  });
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

  await expect(
    prepareJudgeProgram({ problemId: "broken-1", context, signal }),
  ).resolves.toEqual({
    ok: false,
    reason: "build_failed",
    diagnostics: "main.cpp:2:1: error: expected ';'",
  });
});

it("refetches the source on every preparation but builds each digest once", async () => {
  await prepareJudgeProgram({ problemId: "memo-1", context, signal });
  await prepareJudgeProgram({ problemId: "memo-1", context, signal });

  expect(fakes.fetch).toHaveBeenCalledTimes(2);
  expect(fakes.engine.compile).toHaveBeenCalledOnce();
});

it("rebuilds when the source's digest changes", async () => {
  await prepareJudgeProgram({ problemId: "digest-1", context, signal });
  fakes.fetch.mockImplementation(async () =>
    respondWith({ ...pythonChecker, source: "reject()\n", sha256: "c".repeat(64) }),
  );
  await prepareJudgeProgram({ problemId: "digest-1", context, signal });

  expect(fakes.engine.compile).toHaveBeenCalledTimes(2);
  expect(fakes.engine.compile.mock.calls[1]![0].files["main.py"]!.endsWith("reject()\n")).toBe(
    true,
  );
});

it("rebuilds when only the language changes", async () => {
  await prepareJudgeProgram({ problemId: "language-1", context, signal });
  fakes.fetch.mockImplementation(async () =>
    respondWith({ ...cppChecker, sha256: pythonChecker.sha256 }),
  );

  await expect(
    prepareJudgeProgram({ problemId: "language-1", context, signal }),
  ).resolves.toMatchObject({ ok: true, language: "cpp" });
  expect(fakes.engine.compile).toHaveBeenCalledTimes(2);
  expect(fakes.engine.compile.mock.calls[1]![0].language).toBe("cpp");
});

it("rebuilds when only the role changes", async () => {
  await prepareJudgeProgram({ problemId: "role-1", context, signal });
  fakes.fetch.mockImplementation(async () =>
    respondWith({ ...pythonChecker, role: "interactor" }),
  );

  await expect(
    prepareJudgeProgram({ problemId: "role-1", context, signal }),
  ).resolves.toMatchObject({ ok: true, role: "interactor" });
  expect(fakes.engine.compile).toHaveBeenCalledTimes(2);
  expect(fakes.engine.compile.mock.calls[1]![0].projectId).toBe(
    "nojv-judge-program-v1-role-1-interactor-python",
  );
});

it("drops a queued build when its editor closes, so the next visit builds it", async () => {
  let finishBusy!: (value: unknown) => void;
  fakes.engine.compile.mockImplementationOnce(
    () => new Promise((resolve) => (finishBusy = resolve)),
  );
  const busy = prepareJudgeProgram({ problemId: "busy-1", context, signal });
  await vi.waitFor(() => expect(fakes.engine.compile).toHaveBeenCalledOnce());
  const leaving = new AbortController();
  const progress: unknown[] = [];
  const left = prepareJudgeProgram(
    { problemId: "left-1", context, signal: leaving.signal },
    (update) => progress.push(update),
  );
  await vi.waitFor(() => expect(progress).toContainEqual({ phase: "build" }));

  leaving.abort();
  finishBusy(built);
  await expect(busy).resolves.toMatchObject({ ok: true });
  await expect(left).resolves.toEqual({ ok: false, reason: "load_failed" });
  expect(fakes.engine.compile).toHaveBeenCalledOnce();
  expect(fakes.warn).not.toHaveBeenCalled();

  await expect(
    prepareJudgeProgram({ problemId: "left-1", context, signal }),
  ).resolves.toMatchObject({ ok: true });
  expect(fakes.engine.compile).toHaveBeenCalledTimes(2);
  expect(fakes.engine.compile.mock.calls[1]![0].projectId).toBe(
    "nojv-judge-program-v1-left-1-checker-python",
  );
});

it("finishes and keeps a build that started before its editor closed", async () => {
  let finishBuild!: (value: unknown) => void;
  fakes.engine.compile.mockImplementationOnce(
    () => new Promise((resolve) => (finishBuild = resolve)),
  );
  const leaving = new AbortController();
  const left = prepareJudgeProgram({ problemId: "started-1", context, signal: leaving.signal });
  await vi.waitFor(() => expect(fakes.engine.compile).toHaveBeenCalledOnce());

  leaving.abort();
  finishBuild(built);
  await expect(left).resolves.toMatchObject({ ok: true });
  expect(fakes.engine.cancel).not.toHaveBeenCalled();

  await prepareJudgeProgram({ problemId: "started-1", context, signal });
  expect(fakes.engine.compile).toHaveBeenCalledOnce();
});

it("retries a failing source request before reporting a load failure", async () => {
  vi.useFakeTimers();
  fakes.fetch.mockImplementation(async () => respondWith({}, 503));

  const pending = prepareJudgeProgram({ problemId: "flaky-1", context, signal });
  await vi.advanceTimersByTimeAsync(7_000);

  await expect(pending).resolves.toEqual({ ok: false, reason: "load_failed" });
  expect(fakes.fetch).toHaveBeenCalledTimes(3);
  expect(fakes.engine.compile).not.toHaveBeenCalled();
  expect(fakes.warn).toHaveBeenCalledWith(
    "Couldn't load the judge program.",
    new Error("Judge program request failed with 503."),
  );
});

it.each([403, 404])(
  "reports a %i source request as unavailable without retrying",
  async (status) => {
    fakes.fetch.mockImplementation(async () => respondWith({ message: "No" }, status));

    await expect(
      prepareJudgeProgram({ problemId: "refused-1", context, signal }),
    ).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(fakes.fetch).toHaveBeenCalledOnce();
    expect(fakes.warn).toHaveBeenCalledWith(
      `Judge program request failed with ${String(status)}.`,
    );
  },
);

it("reports a malformed source response as a load failure", async () => {
  vi.useFakeTimers();
  fakes.fetch.mockImplementation(async () => respondWith({ ...pythonChecker, sha256: "x" }));

  const pending = prepareJudgeProgram({ problemId: "malformed-1", context, signal });
  await vi.advanceTimersByTimeAsync(7_000);

  await expect(pending).resolves.toEqual({ ok: false, reason: "load_failed" });
  expect(fakes.engine.compile).not.toHaveBeenCalled();
  expect(fakes.warn).toHaveBeenCalledWith(
    "Couldn't load the judge program.",
    expect.any(Error),
  );
});

it("reports a toolchain that can't be loaded as a load failure", async () => {
  const failure = new TypeError("Failed to fetch");
  fakes.preload.mockRejectedValue(failure);

  await expect(
    prepareJudgeProgram({ problemId: "toolchain-1", context, signal }),
  ).resolves.toEqual({
    ok: false,
    reason: "load_failed",
  });
  expect(fakes.engine.compile).not.toHaveBeenCalled();
  expect(fakes.warn).toHaveBeenCalledWith(
    "Couldn't load the judge program's toolchain.",
    failure,
  );
});

it("reports an engine failure as a load failure and builds again next time", async () => {
  const failure = new Error("Failed to fetch");
  fakes.engine.compile.mockRejectedValueOnce(failure);

  await expect(
    prepareJudgeProgram({ problemId: "engine-1", context, signal }),
  ).resolves.toEqual({
    ok: false,
    reason: "load_failed",
  });
  expect(fakes.warn).toHaveBeenCalledWith("Couldn't build the judge program.", failure);
  await expect(
    prepareJudgeProgram({ problemId: "engine-1", context, signal }),
  ).resolves.toMatchObject({
    ok: true,
  });
  expect(fakes.engine.compile).toHaveBeenCalledTimes(2);
});
