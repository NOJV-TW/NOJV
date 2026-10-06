// @vitest-environment jsdom

import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { testJudgeDomain } from "@nojv/application";

import { m } from "$lib/paraglide/messages.js";

const mocks = vi.hoisted(() => ({
  invalidateAll: vi.fn(),
  submitFormAction: vi.fn(),
}));

vi.mock("$app/navigation", () => ({ invalidateAll: mocks.invalidateAll }));
vi.mock("$lib/utils/actions", () => ({ submitFormAction: mocks.submitFormAction }));

const { default: JudgeProgramTestStatus } =
  await import("$lib/components/features/problem/tabs/judge/JudgeProgramTestStatus.svelte");

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  target.remove();
});

function render(
  status: testJudgeDomain.JudgeProgramStatus,
  options: {
    checksSamples?: boolean;
    testJudgeDisabled?: boolean;
    hasUnsavedChanges?: boolean;
  } = {},
) {
  component = mount(JudgeProgramTestStatus, {
    target,
    props: {
      status,
      checksSamples: options.checksSamples ?? true,
      testJudgeDisabled: options.testJudgeDisabled ?? false,
      hasUnsavedChanges: options.hasUnsavedChanges ?? false,
    },
  });
  flushSync();
}

function statusText(): string | undefined {
  return target.querySelector('[role="status"]')?.textContent?.trim();
}

function checkButton(): HTMLButtonElement | null {
  return (
    [...target.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(m.admin_checkSamples()),
    ) ?? null
  );
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await tick();
}

describe("JudgeProgramTestStatus", () => {
  it("says Test can run a built judge program", () => {
    render({ status: "ok" });

    expect(statusText()).toBe(m.admin_judgeProgramTestReady());
    expect(checkButton()).not.toBeNull();
  });

  it("says the judge program is still being prepared", () => {
    render({ status: "pending" });

    expect(statusText()).toBe(m.admin_judgeProgramTestPending());
  });

  it("shows the build output of a failed judge program and hides the sample check", () => {
    render({ status: "failed", diagnostics: "main.cpp:3:1: error: no threads" });

    expect(statusText()).toBe(m.admin_judgeProgramTestFailed());
    const details = target.querySelector("details");
    expect(details?.querySelector("summary")?.textContent?.trim()).toBe(
      m.admin_judgeProgramDiagnostics(),
    );
    expect(details?.querySelector("pre")?.textContent).toBe("main.cpp:3:1: error: no threads");
    expect(checkButton()).toBeNull();
  });

  it("shows nothing for a problem Test does not judge", () => {
    render({ status: "not_applicable" });

    expect(target.textContent?.trim()).toBe("");
  });

  it("says when Test judging is not enabled on the server", () => {
    render({ status: "not_applicable" }, { testJudgeDisabled: true });

    expect(target.textContent?.trim()).toBe(m.admin_testJudgeDisabled());
  });

  it("offers no sample check on an interactive problem", () => {
    render({ status: "ok" }, { checksSamples: false });

    expect(checkButton()).toBeNull();
  });

  it("asks to save before checking samples against unsaved changes", () => {
    render({ status: "ok" }, { hasUnsavedChanges: true });

    expect(checkButton()?.disabled).toBe(true);
    expect(target.textContent).toContain(m.admin_checkSamplesSaveFirst());
  });

  it("lists each sample with the checker's verdict and explains rejections", async () => {
    mocks.submitFormAction.mockResolvedValue({
      success: true,
      results: [
        { sampleIndex: 0, verdict: "AC" },
        { sampleIndex: 1, verdict: "WA", teamMessage: "expected YES or NO" },
      ],
    });
    render({ status: "ok" });

    checkButton()!.click();
    await settle();

    expect(mocks.submitFormAction).toHaveBeenCalledWith("?/checkSamples");
    const items = [...target.querySelectorAll("li")];
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("✓");
    expect(items[0]?.textContent).toContain(m.admin_sampleNumber({ number: 1 }));
    expect(items[0]?.querySelector("pre")).toBeNull();
    expect(items[1]?.textContent).toContain("✗");
    expect(items[1]?.textContent).toContain("WA");
    expect(items[1]?.querySelector("pre")?.textContent).toBe("expected YES or NO");
    expect(target.textContent).toContain(m.admin_checkSamplesRejected());
    expect(mocks.invalidateAll).not.toHaveBeenCalled();
  });

  it("does not explain rejections when every sample is accepted", async () => {
    mocks.submitFormAction.mockResolvedValue({
      success: true,
      results: [{ sampleIndex: 0, verdict: "AC" }],
    });
    render({ status: "pending" });

    checkButton()!.click();
    await settle();

    expect(target.querySelectorAll("li")).toHaveLength(1);
    expect(target.textContent).not.toContain(m.admin_checkSamplesRejected());
    expect(mocks.invalidateAll).toHaveBeenCalledOnce();
  });

  it.each([
    ["test_judge_busy", () => m.editor_testJudgeBusy()],
    ["test_judge_unavailable", () => m.admin_checkSamplesUnavailable()],
    ["judge_program_build_failed", () => m.admin_judgeProgramTestFailed()],
    ["This problem has no samples to check.", () => "This problem has no samples to check."],
  ])("explains a %s failure", async (code, expected) => {
    mocks.submitFormAction.mockRejectedValue(new Error(code));
    render({ status: "ok" });

    checkButton()!.click();
    await settle();

    expect(target.querySelector('[role="alert"]')?.textContent).toBe(expected());
    expect(target.querySelectorAll("li")).toHaveLength(0);
  });
});
