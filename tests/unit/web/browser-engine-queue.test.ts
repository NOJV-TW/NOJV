import { beforeEach, expect, it, vi } from "vitest";
import {
  compileBrowserJudgeProgram,
  compileBrowserLocally,
  runBrowserCases,
} from "$lib/services/browser-local-run";

type Deferred = { resolve: (value: unknown) => void; reject: (error: unknown) => void };

const engine = vi.hoisted(() => ({
  pending: [] as Deferred[],
  building: false,
  compile: vi.fn<(input: { projectId: string }) => Promise<unknown>>(),
  run: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("../../../apps/web/node_modules/@wasm-oj/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../apps/web/node_modules/@wasm-oj/browser")>()),
  createBrowserEngine: vi.fn().mockResolvedValue(engine),
}));

const built = {
  success: true,
  artifact: { id: "built" },
  diagnostics: [],
  stdout: "",
  stderr: "",
};
const checker = {
  role: "checker",
  language: "cpp",
  source: "int main() { return 42; }",
} as const;
const request = {
  context: { type: "practice" },
  language: "cpp",
  problemId: "next",
  sourceCode: "int main() {}",
} as const;
const limits = { language: "cpp", timeLimitMs: 1000, memoryLimitMb: 64, env: {} } as const;

beforeEach(() => {
  engine.pending = [];
  engine.building = false;
  engine.compile.mockReset().mockImplementation(() => {
    if (engine.building) {
      return Promise.reject(
        new Error("The compiler already has a different foreground build in progress."),
      );
    }
    engine.building = true;
    return new Promise((resolve, reject) => {
      const settle = (finish: () => void) => {
        engine.building = false;
        finish();
      };
      engine.pending.push({
        resolve: (value) => settle(() => resolve(value)),
        reject: (error) => settle(() => reject(error)),
      });
    });
  });
  engine.run.mockReset().mockResolvedValue({
    termination: "exited",
    code: 0,
    stdout: "",
    stderr: "",
    durationMs: 1,
    metrics: { logicalTimeNs: 1, memoryBytes: 1024 },
  });
  engine.cancel.mockReset();
});

async function settle() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

it("queues a student compile behind a judge-program build that is still running", async () => {
  const checkerBuild = compileBrowserJudgeProgram(
    "checker-problem",
    checker,
    new AbortController().signal,
  );
  await vi.waitFor(() => expect(engine.compile).toHaveBeenCalledOnce());

  const studentBuild = compileBrowserLocally(request, "next", new AbortController().signal);
  await settle();
  expect(engine.compile).toHaveBeenCalledOnce();

  engine.pending.shift()!.resolve(built);
  await expect(checkerBuild).resolves.toEqual({ ok: true, artifact: { id: "built" } });
  await vi.waitFor(() => expect(engine.compile).toHaveBeenCalledTimes(2));
  expect(engine.compile.mock.calls[1]![0].projectId).toBe("nojv-local-browser-v1-next-cpp");
  engine.pending.shift()!.resolve(built);
  await expect(studentBuild).resolves.toEqual({ ok: true, artifact: { id: "built" } });
  expect(engine.cancel).not.toHaveBeenCalled();
});

it("lets an aborted waiter leave the queue without cancelling the build ahead of it", async () => {
  const checkerBuild = compileBrowserJudgeProgram(
    "checker-problem",
    checker,
    new AbortController().signal,
  );
  await vi.waitFor(() => expect(engine.compile).toHaveBeenCalledOnce());
  const leaving = new AbortController();
  const abandoned = compileBrowserLocally(request, "next", leaving.signal);
  const staying = runBrowserCases(
    { id: "student" } as never,
    [{ input: "1" }],
    limits,
    new AbortController().signal,
  );

  leaving.abort();
  await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });
  await settle();
  expect(engine.cancel).not.toHaveBeenCalled();
  expect(engine.run).not.toHaveBeenCalled();

  engine.pending.shift()!.resolve(built);
  await expect(checkerBuild).resolves.toMatchObject({ ok: true });
  await expect(staying).resolves.toHaveLength(1);
  expect(engine.compile).toHaveBeenCalledOnce();
});

it("cancels the engine only for the operation that is running", async () => {
  const leaving = new AbortController();
  const studentBuild = compileBrowserLocally(request, "next", leaving.signal);
  await vi.waitFor(() => expect(engine.compile).toHaveBeenCalledOnce());
  const checkerBuild = compileBrowserJudgeProgram(
    "checker-problem",
    checker,
    new AbortController().signal,
  );

  leaving.abort();
  expect(engine.cancel).toHaveBeenCalledOnce();
  engine.pending.shift()!.reject(new Error("Cancelled."));
  await expect(studentBuild).rejects.toThrow("Cancelled.");

  await vi.waitFor(() => expect(engine.compile).toHaveBeenCalledTimes(2));
  engine.pending.shift()!.resolve(built);
  await expect(checkerBuild).resolves.toMatchObject({ ok: true });
  expect(engine.cancel).toHaveBeenCalledOnce();
});
