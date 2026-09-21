// @vitest-environment jsdom
import { mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmitFunction, ActionResult } from "@sveltejs/kit";
import type { Writable } from "svelte/store";
import { m } from "$lib/paraglide/messages.js";

interface TestPage {
  status: number;
  data: Record<string, unknown>;
  form: unknown;
  url: URL;
}
const mocks = vi.hoisted(() => ({
  invalidateAll: vi.fn().mockResolvedValue(undefined),
  fetch: vi.fn(),
  page: undefined as Writable<TestPage> | undefined,
  enhanced: new Map<HTMLFormElement, SubmitFunction>(),
}));
vi.mock("$app/environment", () => ({
  browser: true,
  dev: true,
  building: false,
  version: "test",
}));
vi.mock("$app/stores", async () => {
  const { writable } = await import("svelte/store");
  mocks.page = writable({
    status: 200,
    data: {},
    form: null,
    url: new URL("http://localhost/assignments/assignment-A"),
  });
  return { page: mocks.page, navigating: writable(null) };
});
vi.mock("$app/navigation", () => ({
  beforeNavigate: vi.fn(),
  afterNavigate: vi.fn(),
  invalidateAll: mocks.invalidateAll,
  goto: vi.fn(),
}));
vi.mock("$app/forms", () => ({
  deserialize: JSON.parse,
  enhance(element: HTMLFormElement, submit?: SubmitFunction) {
    if (submit) mocks.enhanced.set(element, submit);
    return {
      destroy() {
        mocks.enhanced.delete(element);
      },
    };
  },
  async applyAction(result: ActionResult) {
    if (result.type === "success" || result.type === "failure")
      mocks.page?.update((page) => ({ ...page, status: result.status, form: result.data }));
    await tick();
  },
}));
vi.mock("$lib/components/features/problem/ProblemSelectDialog.svelte", async () => ({
  default: (await import("../../unit/web/fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/problem/admin/RejudgeDialog.svelte", async () => ({
  default: (await import("../../unit/web/fixtures/empty-component.svelte")).default,
}));

import TeacherProblems from "./fixtures/teacher-problems-refresh.svelte";
import { settingsForm, type TeacherProblemSnapshot } from "./fixtures/teacher-refresh-data";

const dispose: (() => Promise<void>)[] = [];
const initial: TeacherProblemSnapshot = {
  id: "context-A",
  totalPoints: 100,
  gradingRevision: 1,
  problems: [
    { id: "p1", title: "Problem One", points: 60 },
    { id: "p2", title: "Problem Two", points: 40 },
  ],
};

beforeEach(() => {
  mocks.fetch
    .mockReset()
    .mockResolvedValue(
      new Response(JSON.stringify({ type: "success", status: 200, data: {} })),
    );
  mocks.invalidateAll.mockClear();
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(async () => {
  for (const cleanup of dispose.splice(0)) await cleanup();
  vi.unstubAllGlobals();
});

async function setup(kind: "assignment" | "exam") {
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(TeacherProblems, {
    target,
    props: { kind, initial: structuredClone(initial) },
  });
  dispose.push(async () => {
    await unmount(component);
    target.remove();
  });
  await tick();
  return { target, component };
}
function field(target: HTMLElement, label: string) {
  const input = [...target.querySelectorAll<HTMLInputElement>("input")].find(
    (item) => item.getAttribute("aria-label") === label,
  );
  expect(input).toBeDefined();
  return input!;
}
async function edit(target: HTMLElement, label: string, value: number) {
  const input = field(target, label);
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await tick();
}
function detachLabel(kind: "assignment" | "exam") {
  return kind === "assignment"
    ? m.assignmentDetail_problemsEditDetachButton()
    : m.examDetail_problemsEditDetachButton();
}
function saveLabel(kind: "assignment" | "exam") {
  return kind === "assignment"
    ? m.assignmentDetail_problemsEditSaveButton()
    : m.examDetail_problemsEditSaveButton();
}
function findButton(target: HTMLElement, label: string) {
  return [...target.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === label,
  );
}

async function payload(target: HTMLElement, kind: "assignment" | "exam") {
  if (kind === "exam")
    return JSON.parse(target.querySelector<HTMLInputElement>('input[name="payload"]')!.value);
  const save = findButton(target, saveLabel(kind));
  expect(save).toBeDefined();
  save!.click();
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  const body = mocks.fetch.mock.calls[0]![1].body as FormData;
  return JSON.parse(String(body.get("payload")));
}

describe.each(["assignment", "exam"] as const)("%s teacher draft protection", (kind) => {
  it("keeps unsaved allocation and removed problems across background props updates, including the original revision", async () => {
    const { target, component } = await setup(kind);
    await edit(target, m.activityWeights_total(), 200);
    const detach = [...target.querySelectorAll<HTMLButtonElement>("button")].filter(
      (button) => button.getAttribute("aria-label") === detachLabel(kind),
    );
    expect(detach).toHaveLength(2);
    detach[1]!.click();
    await tick();
    await edit(target, m.activityWeights_weight({ title: "Problem One" }), 100);
    component.refresh({
      ...structuredClone(initial),
      totalPoints: 120,
      gradingRevision: 2,
      problems: [
        { id: "p1", title: "Problem One", points: 30 },
        { id: "p2", title: "Problem Two", points: 90 },
      ],
    });
    await tick();
    expect(field(target, m.activityWeights_total()).value).toBe("200");
    expect(field(target, m.activityWeights_weight({ title: "Problem One" })).value).toBe("100");
    expect(target.textContent).not.toContain("Problem Two");
    expect(await payload(target, kind)).toEqual({
      totalPoints: 200,
      gradingRevision: 1,
      problems: [{ problemId: "p1", points: 200 }],
    });
  });

  it("resets drafts when the same mounted component receives a different context", async () => {
    const { target, component } = await setup(kind);
    await edit(target, m.activityWeights_total(), 200);
    component.refresh({
      id: "context-B",
      totalPoints: 75,
      gradingRevision: 7,
      problems: [{ id: "p3", title: "Problem Three", points: 75 }],
    });
    await tick();
    expect(field(target, m.activityWeights_total()).value).toBe("75");
    expect(target.textContent).toContain("Problem Three");
    expect(target.textContent).not.toContain("Problem One");
    expect(findButton(target, saveLabel(kind))).toBeUndefined();
    if (kind === "exam")
      expect(await payload(target, kind)).toMatchObject({ gradingRevision: 7 });
  });

  it("accepts clean server refreshes again after the server acknowledges the saved draft", async () => {
    const { target, component } = await setup(kind);
    await edit(target, m.activityWeights_total(), 200);
    component.refresh({
      ...structuredClone(initial),
      totalPoints: 200,
      gradingRevision: 2,
      problems: [
        { id: "p1", title: "Problem One", points: 120 },
        { id: "p2", title: "Problem Two", points: 80 },
      ],
    });
    await tick();
    expect(findButton(target, saveLabel(kind))).toBeUndefined();
    component.refresh({
      ...structuredClone(initial),
      totalPoints: 150,
      gradingRevision: 3,
      problems: [
        { id: "p1", title: "Problem One", points: 30 },
        { id: "p2", title: "Problem Two", points: 120 },
      ],
    });
    await tick();
    expect(field(target, m.activityWeights_total()).value).toBe("150");
    expect(field(target, m.activityWeights_weight({ title: "Problem One" })).value).toBe("20");
    expect(findButton(target, saveLabel(kind))).toBeUndefined();
  });
});

describe("actual settings Superforms refresh behavior", () => {
  it("keeps a typed draft during page-store refresh, accepts a successful action, and resets on a context key change", async () => {
    const { default: Settings } = await import("./fixtures/teacher-settings-refresh.svelte");
    mocks.page!.set({
      status: 200,
      data: {},
      form: null,
      url: new URL("http://localhost/assignments/assignment-A"),
    });
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(Settings, { target });
    dispose.push(async () => {
      await unmount(component);
      target.remove();
    });
    await tick();
    const title = () => target.querySelector<HTMLInputElement>("#settings-title")!;
    expect(title().value).toBe("Original title");
    title().value = "Unsaved teacher title";
    title().dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    component.refresh("assignment-A", "Background server title");
    mocks.page!.update((page) => ({
      ...page,
      data: { settingsForm: settingsForm("Background server title") },
    }));
    await tick();
    expect(title().value).toBe("Unsaved teacher title");

    const formElement = target.querySelector<HTMLFormElement>(
      'form[action="?/updateSettings"]',
    )!;
    const submit = mocks.enhanced.get(formElement);
    expect(submit).toBeDefined();
    const formData = new FormData(formElement);
    const action = new URL(formElement.action);
    const complete = await submit!({
      action,
      formData,
      formElement,
      controller: new AbortController(),
      submitter: null,
      cancel: vi.fn(),
    });
    expect(complete).toBeTypeOf("function");
    const saved = {
      ...settingsForm("Saved teacher title"),
      posted: true,
      message: { kind: "success" as const, text: "Saved" },
    };
    await complete!({
      action,
      formData,
      formElement,
      result: { type: "success", status: 200, data: { form: saved } },
      update: async () => {},
    });
    await tick();
    expect(title().value).toBe("Saved teacher title");
    expect(mocks.invalidateAll).toHaveBeenCalled();

    mocks.page!.update((page) => ({ ...page, form: null, data: {} }));
    component.refresh("assignment-B", "Different assignment title");
    await tick();
    expect(title().value).toBe("Different assignment title");
  });
});
