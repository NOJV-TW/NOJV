import { expect, it, vi } from "vitest";
import type { PreparedJudgeProgram } from "$lib/services/judge-program";

const engine = vi.hoisted(() => {
  let answerLate: (() => void) | undefined;
  const exited = (code: number, stdout = "") => ({
    termination: "exited",
    code,
    stdout,
    stderr: "",
    files: {},
    durationMs: 1,
    metrics: { logicalTimeNs: 1, memoryBytes: 1024 },
  });
  return {
    compile: vi.fn().mockResolvedValue({ success: true, artifact: { id: "solution" } }),
    run: vi
      .fn()
      .mockResolvedValueOnce(exited(0, "3\n"))
      .mockImplementationOnce(
        () => new Promise((resolve) => (answerLate = () => resolve(exited(42)))),
      ),
    cancel: vi.fn(() => answerLate?.()),
  };
});
const toast = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/web/node_modules/@wasm-oj/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../apps/web/node_modules/@wasm-oj/browser")>()),
  createBrowserEngine: vi.fn().mockResolvedValue(engine),
  prefetchBrowserToolchain: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("$lib/stores/toast", () => ({ toasts: { error: toast } }));
import { createEditorRunController } from "$lib/components/features/problem/editors/use-editor-run.svelte";

const checkerReady = {
  ok: true,
  role: "checker",
  language: "cpp",
  artifact: { id: "checker" },
} as unknown as PreparedJudgeProgram;

it("cancels the checker run when the editor is destroyed and drops its late result", async () => {
  const controller = createEditorRunController({
    problemId: "cancel",
    initialSamples: [{ input: "1 2", output: "3" }],
    language: () => "cpp",
    isWorkspaceMode: () => false,
    isSpecialEnv: () => false,
    judgeType: () => "checker",
    judgeConfig: () => ({ type: "checker" }),
    timeLimitMs: 1000,
    memoryLimitMb: 64,
    drafts: () => ({ cpp: "int main() {}" }),
    workspaceDrafts: () => ({}),
    workspaceFiles: () => [],
    context: () => ({ type: "practice" }),
    judgeProgram: () => Promise.resolve(checkerReady),
  });

  const running = controller.run();
  await vi.waitFor(() => expect(engine.run).toHaveBeenCalledTimes(2));
  expect(engine.run.mock.calls[1]![0]).toEqual({ id: "checker" });

  controller.markDestroyed();
  expect(engine.cancel).toHaveBeenCalledOnce();
  await running;

  expect(controller.runResult).toBeNull();
  expect(controller.runError).toBeNull();
  expect(toast).not.toHaveBeenCalled();
});
