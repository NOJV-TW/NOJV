// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { m } from "$lib/paraglide/messages.js";

const mocks = vi.hoisted(() => ({
  executeSubmission: vi.fn(),
  invalidateAll: vi.fn(),
  toastError: vi.fn(),
  watch: vi.fn(),
  read: vi.fn(),
}));

vi.mock("$lib/services/submission-tracker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/services/submission-tracker")>()),
  watchSubmissionStates: mocks.watch,
  submissionRead: mocks.read,
}));
vi.mock("$app/navigation", () => ({ invalidateAll: mocks.invalidateAll }));
vi.mock("$lib/services/submission-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/services/submission-service")>()),
  executeSubmission: mocks.executeSubmission,
}));
vi.mock("$lib/stores/toast", () => ({ toasts: { error: mocks.toastError } }));
vi.mock("$lib/components/primitives/ui/MonacoScriptEditor.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));

const { default: ReferenceSolutionSection } =
  await import("$lib/components/features/problem/reference/ReferenceSolutionSection.svelte");

let target: HTMLDivElement;
let component: ReturnType<typeof mount>;

beforeEach(() => {
  vi.clearAllMocks();
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(async () => {
  if (component) await unmount(component);
  target.remove();
});

function render(
  initial: {
    status: "not_configured" | "validating" | "verified" | "failed";
    submissionId: string | null;
    language: string | null;
    sourceFiles: { path: string; content: string }[];
  } = { status: "not_configured", submissionId: null, language: null, sourceFiles: [] },
) {
  component = mount(ReferenceSolutionSection, {
    target,
    props: {
      problemId: "problem_1",
      problemType: "full_source",
      initial,
      starterByLanguage: { python: "print(1)" },
      workspaceFiles: [],
    },
  });
  return target.querySelector<HTMLButtonElement>("button[type=button]")!;
}

describe("ReferenceSolutionSection", () => {
  it("submits once without claiming reference validity when page refresh fails", async () => {
    let resolveSubmission!: (value: { accepted: boolean; feedback: string }) => void;
    mocks.executeSubmission.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmission = resolve;
      }),
    );
    mocks.invalidateAll.mockRejectedValue(new Error("refresh failed"));

    const button = render();
    button.click();
    button.click();
    expect(mocks.executeSubmission).toHaveBeenCalledTimes(1);

    resolveSubmission({ accepted: true, feedback: "Accepted" });

    await vi.waitFor(() => {
      expect(target.querySelector('[role="status"]')?.textContent).toContain(
        m.admin_referenceNotConfigured(),
      );
      expect(mocks.toastError).toHaveBeenCalledWith(m.admin_referenceRefreshFailed());
    });
  });

  it("shows the submission error message", async () => {
    mocks.executeSubmission.mockRejectedValue(new Error("Judge service unavailable"));

    render().click();

    await vi.waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("Judge service unavailable");
    });
  });

  it("shows the failed testcase group and one-based testcase number", async () => {
    mocks.executeSubmission.mockResolvedValue({
      accepted: false,
      caseResults: [
        { index: 0, verdict: "AC", timeMs: 4 },
        { index: 1, verdict: "WA", timeMs: 7 },
      ],
      feedback: "Failed on testcase 2: wrong answer",
      runtimeMs: 7,
      score: 0,
      subtaskResults: [
        {
          cases: [
            { index: 0, verdict: "AC", timeMs: 4 },
            { index: 1, verdict: "WA", timeMs: 7 },
          ],
          label: "Examples",
          passed: false,
          rawScore: 0,
          testcaseSetId: "set_1",
          weight: 100,
        },
      ],
      verdict: "wrong_answer",
    });

    render().click();

    await vi.waitFor(() => {
      expect(target.textContent).toContain(m.admin_referenceFailureDetails());
      expect(target.textContent).toContain("#subtask1");
      expect(target.textContent).not.toContain("Examples");
      expect(target.textContent).toContain("#2");
      expect(target.textContent).toContain("WA");
    });
  });
  it("restores failed validation details and retries a failed detail read", async () => {
    let update!: (operation: import("@nojv/core").SubmissionOperation) => void;
    mocks.watch.mockImplementation((_ids, listener) => {
      update = listener;
      return () => {};
    });
    mocks.read.mockRejectedValueOnce(new Error("Offline"));
    render({
      status: "validating",
      submissionId: "reference_1",
      language: "python",
      sourceFiles: [],
    });
    await vi.waitFor(() => expect(update).toBeDefined());
    const operation = {
      submissionId: "reference_1",
      problemId: "problem_1",
      problemTitle: "Reference",
      judgeGeneration: 1,
      updatedAt: "2026-09-21T00:00:00.000Z",
      status: "wrong_answer" as const,
      result: {
        accepted: false,
        verdict: "wrong_answer" as const,
        score: 0,
        runtimeMs: 1,
        feedback: "Wrong answer",
      },
    };
    update(operation);
    await vi.waitFor(() => expect(target.querySelector('[role="alert"]')).not.toBeNull());
    mocks.read.mockResolvedValueOnce({
      ...operation,
      result: {
        ...operation.result,
        feedback: "Failed on testcase 2",
        caseResults: [{ index: 1, verdict: "WA", timeMs: 1 }],
      },
    });
    [...target.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === m.common_retry())!
      .click();
    await vi.waitFor(() => expect(target.textContent).toContain("Failed on testcase 2"));
    expect(target.textContent).toContain("#2");
    update({ ...operation, judgeGeneration: 2, status: "queued", result: null });
    await vi.waitFor(() => expect(target.textContent).not.toContain("Failed on testcase 2"));
    expect(target.querySelector('[role="status"]')?.textContent).toContain(
      m.admin_referenceValidating(),
    );
  });

  it("does not treat an old accepted result as a valid reference after configuration changes", async () => {
    let update!: (operation: import("@nojv/core").SubmissionOperation) => void;
    mocks.watch.mockImplementation((_ids, listener) => {
      update = listener;
      return () => {};
    });
    render({
      status: "failed",
      submissionId: "reference_old",
      language: "python",
      sourceFiles: [],
    });
    await vi.waitFor(() => expect(update).toBeDefined());
    update({
      submissionId: "reference_old",
      problemId: "problem_1",
      problemTitle: "Reference",
      judgeGeneration: 1,
      updatedAt: "2026-09-21T00:00:00.000Z",
      status: "accepted",
      result: {
        accepted: true,
        verdict: "accepted",
        score: 100,
        runtimeMs: 1,
        feedback: "Accepted",
      },
    });
    await vi.waitFor(() =>
      expect(target.querySelector('[role="status"]')?.textContent).toContain(
        m.admin_referenceFailed(),
      ),
    );
    expect(target.textContent).not.toContain(m.admin_referenceFailureDetails());
  });
});
