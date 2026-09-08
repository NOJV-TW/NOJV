import { beforeEach, expect, it, vi } from "vitest";
import type { JudgeType } from "@nojv/core";
import { m } from "$lib/paraglide/messages.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  run: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("$lib/services/submission-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/services/submission-service")>()),
  executeSubmission: mocks.execute,
}));
vi.mock("$lib/services/browser-local-run", () => ({
  shouldUseBrowserLocalRun: () => true,
  runBrowserLocally: mocks.run,
}));
vi.mock("$lib/stores/toast", () => ({ toasts: { error: mocks.toast } }));
import { createEditorRunController } from "$lib/components/features/problem/editors/use-editor-run.svelte";

beforeEach(() => vi.clearAllMocks());

function controller(judgeType: JudgeType, specialEnv = false) {
  return createEditorRunController({
    problemId: "test",
    initialSamples: [{ input: "", output: "42" }],
    language: () => "cpp",
    isWorkspaceMode: () => false,
    isSpecialEnv: () => specialEnv,
    judgeType: () => judgeType,
    judgeConfig: () => ({ type: judgeType }),
    timeLimitMs: 1000,
    memoryLimitMb: 128,
    drafts: () => ({ cpp: '#include "helper.h"\nint main(){return answer();}' }),
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

it.each(["checker", "interactive"] as const)(
  "%s Test reports unavailable private judging without submitting to server",
  async (type) => {
    const run = controller(type);
    await run.run();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(run.runError).toBe(m.editor_clientTestPrivateJudge());
  },
);

it("custom container Test reports its browser requirement without contacting server", async () => {
  const run = controller("standard", true);
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

it("asks for a testcase before starting the browser when the problem has no samples", async () => {
  const run = controller("standard");
  run.panelRunCases = [];
  await run.run();
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
  expect(run.runError).toBe(m.editor_invalidRunCases());
});
