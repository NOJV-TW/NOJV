import { mount, tick, unmount } from "svelte";
import { afterEach, expect, it } from "vitest";
import { MAX_RUN_CASES } from "@nojv/core";
import { m } from "$lib/paraglide/messages.js";
import type { TestCaseView, TestRunResult } from "$lib/types";
import Panel from "$lib/components/features/problem/editors/EditorBottomPanel.svelte";

let component: ReturnType<typeof mount> | undefined;
let target: HTMLDivElement;
afterEach(async () => {
  if (component) await unmount(component);
  target.remove();
});

it("keeps empty-answer comparison enabled and makes execution-only an explicit choice", async () => {
  target = document.createElement("div");
  document.body.append(target);
  component = mount(Panel, {
    target,
    props: {
      runCases: Array.from({ length: MAX_RUN_CASES }, () => ({
        input: "",
        expectedOutput: "",
      })),
      tab: "testcase",
      runResult: null,
      runStatus: null,
      runError: null,
      ontabchange: () => {},
    },
  });
  await tick();
  const checkbox = target.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const expected = target.querySelector<HTMLTextAreaElement>(
    `textarea[aria-label="${m.editor_expectLabel()}"]`,
  )!;
  expect(checkbox.checked).toBe(true);
  expect(expected.disabled).toBe(false);
  expect(expected.value).toBe("");
  checkbox.click();
  await tick();
  expect(expected.disabled).toBe(true);
  checkbox.click();
  await tick();
  expect(expected.disabled).toBe(false);
  expect(expected.value).toBe("");
  expect(
    target.querySelector<HTMLButtonElement>(`button[aria-label="${m.editor_testcase()}"]`)!
      .disabled,
  ).toBe(true);
});

function mountPanel(props: Record<string, unknown>) {
  target = document.createElement("div");
  document.body.append(target);
  component = mount(Panel, {
    target,
    props: {
      runCases: [],
      tab: "testcase",
      runResult: null,
      runStatus: null,
      runError: null,
      ontabchange: () => {},
      ...props,
    },
  });
  return tick();
}

function result(caseResults: TestCaseView[]): TestRunResult {
  return {
    accepted: caseResults.every((caseResult) => caseResult.verdict === "AC"),
    caseResults,
    feedback: "",
    runtimeMs: 12,
    memoryKb: 0,
    score: 0,
    verdict: caseResults.every((caseResult) => caseResult.verdict === "AC")
      ? "accepted"
      : "wrong_answer",
  };
}

it("shows interactive samples read-only with the interaction notes", async () => {
  await mountPanel({
    judgeType: "interactive",
    customCasesAllowed: false,
    interactionFormat: "Read **n** then guess.",
    runCases: [{ input: "1 100\n42\n" }, { input: "1 10\n7\n" }],
  });
  expect(target.querySelector("textarea")).toBeNull();
  expect(target.querySelector('input[type="checkbox"]')).toBeNull();
  expect(target.querySelector(`button[aria-label="${m.editor_testcase()}"]`)).toBeNull();
  expect(
    target.querySelector(`button[aria-label="${m.editor_removeCase({ index: 1 })}"]`),
  ).toBeNull();
  expect(target.textContent).toContain(m.problemDetail_interactionFormat());
  expect(target.querySelector("strong")?.textContent).toBe("n");
  expect(target.textContent).toContain(m.problemDetail_interactorInput());
  expect(target.querySelector("pre")?.textContent).toBe("1 100\n42\n");
  expect(target.textContent).toContain(m.editor_interactiveTestNote());
});

it("explains that an interactive problem without interactor samples has nothing to test", async () => {
  await mountPanel({ judgeType: "interactive", customCasesAllowed: false, runCases: [] });
  expect(target.textContent).toContain(m.editor_testNoInteractiveSamples());
});

it("hides output comparison on checker problems and explains that only samples are judged", async () => {
  await mountPanel({ judgeType: "checker", runCases: [{ input: "1 2", expectedOutput: "3" }] });
  expect(target.querySelector('input[type="checkbox"]')).toBeNull();
  expect(target.querySelector(`textarea[aria-label="${m.editor_expectLabel()}"]`)).toBeNull();
  expect(target.querySelector(`button[aria-label="${m.editor_testcase()}"]`)).not.toBeNull();
  expect(target.textContent).toContain(m.editor_checkerCasesNote());
});

it("renders the interactive transcript instead of an empty output block", async () => {
  await mountPanel({
    tab: "result",
    judgeType: "interactive",
    customCasesAllowed: false,
    runSource: "local",
    runCases: [{ input: "1 100\n42\n" }],
    runResult: result([
      {
        index: 0,
        verdict: "AC",
        serverJudged: true,
        timeMs: 12,
        transcript: { toInteractor: "50\n25\n42\n", toContestant: "1 100\nlower\nhigher\n" },
      },
    ]),
  });
  expect(target.textContent).toContain(m.editor_transcript());
  expect(target.textContent).toContain(m.editor_transcriptFromInteractor());
  expect(target.textContent).toContain(m.editor_transcriptFromProgram());
  const blocks = [...target.querySelectorAll("pre")].map((pre) => pre.textContent);
  expect(blocks).toEqual(["1 100\n42\n", "1 100\nlower\nhigher\n", "50\n25\n42\n"]);
  expect(target.textContent).not.toContain(m.editor_outputLabel());
  expect(target.textContent).not.toContain(m.common_emptyOutput());
  expect(target.textContent).toContain(m.editor_judgedOnServer());
});

it("shows the judge's team message for the selected case", async () => {
  await mountPanel({
    tab: "result",
    judgeType: "checker",
    runCases: [{ input: "1 2", expectedOutput: "3" }],
    runResult: result([
      {
        index: 0,
        verdict: "WA",
        serverJudged: true,
        timeMs: 3,
        stdout: "4\n",
        teamMessage: "Sum is off by one",
      },
    ]),
  });
  expect(target.textContent).toContain(m.editor_judgeFeedback());
  expect(target.textContent).toContain("Sum is off by one");
  expect(target.textContent).not.toContain(m.editor_expectLabel());
});

it("labels execution-only cases as executed rather than accepted", async () => {
  await mountPanel({
    tab: "result",
    judgeType: "checker",
    runCases: [{ input: "custom" }],
    runResult: result([
      { index: 0, verdict: "AC", timeMs: 3, stdout: "out\n", executionOnly: true },
    ]),
  });
  const verdict = target.querySelector('[role="status"] span');
  expect(verdict?.textContent?.trim()).toBe(m.editor_executed());
  expect(target.textContent).not.toContain("AC");
  expect(target.textContent).not.toContain("✔");
  expect(target.textContent).toContain(m.editor_executedNote());
  expect(target.textContent).not.toContain(m.editor_judgedOnServer());
});

it("shows no server badge when every checker sample failed locally", async () => {
  await mountPanel({
    tab: "result",
    judgeType: "checker",
    runCases: [{ input: "1 2", expectedOutput: "3" }, { input: "custom" }],
    runResult: {
      ...result([
        { index: 0, verdict: "RE", timeMs: 3, stdout: "", stderr: "boom" },
        { index: 1, verdict: "AC", timeMs: 3, stdout: "out", executionOnly: true },
      ]),
      verdict: "runtime_error",
    },
  });
  expect(target.querySelector('[role="status"] span')?.textContent?.trim()).toBe("RE");
  expect(target.textContent).not.toContain(m.editor_judgedOnServer());
});

it("keeps local results visible with the server's notice when samples could not be judged", async () => {
  await mountPanel({
    tab: "result",
    judgeType: "checker",
    runCases: [{ input: "1 2", expectedOutput: "3" }],
    runResult: {
      ...result([{ index: 0, verdict: "AC", timeMs: 3, stdout: "3\n", executionOnly: true }]),
      serverNotice: m.editor_testJudgeBusy(),
    },
  });
  expect(target.textContent).toContain(m.editor_testJudgeBusy());
  expect(target.textContent).toContain(m.editor_executed());
  expect(target.textContent).toContain(m.editor_executedNote());
  expect(target.textContent).toContain("3\n");
  expect(target.textContent).not.toContain(m.editor_judgedOnServer());
});

it("explains a server-side judge error on a case", async () => {
  await mountPanel({
    tab: "result",
    judgeType: "interactive",
    customCasesAllowed: false,
    runCases: [{ input: "42" }],
    runResult: result([{ index: 0, verdict: "SE", serverJudged: true, timeMs: 0 }]),
  });
  expect(target.textContent).toContain(m.editor_judgeSystemError());
  expect(target.textContent).toContain(m.editor_judgedOnServer());
});
