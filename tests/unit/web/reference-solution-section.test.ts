// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { m } from "$lib/paraglide/messages.js";

const mocks = vi.hoisted(() => ({
  executeSubmission: vi.fn(),
  invalidateAll: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("$app/navigation", () => ({ invalidateAll: mocks.invalidateAll }));
vi.mock("$lib/services/submission-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/services/submission-service")>()),
  executeSubmission: mocks.executeSubmission,
}));
vi.mock("$lib/stores/toast", () => ({ toasts: { error: mocks.toastError } }));
vi.mock("$lib/components/features/problem/editors/MonacoScriptEditor.svelte", async () => ({
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

function render() {
  component = mount(ReferenceSolutionSection, {
    target,
    props: {
      problemId: "problem_1",
      problemType: "full_source",
      initial: { status: "not_configured", language: null, sourceFiles: [] },
      starterByLanguage: { python: "print(1)" },
      workspaceFiles: [],
    },
  });
  return target.querySelector<HTMLButtonElement>("button[type=button]")!;
}

describe("ReferenceSolutionSection", () => {
  it("submits once and remains verified when page refresh fails", async () => {
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
        m.admin_referenceVerified(),
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
});
