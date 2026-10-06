// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";
import type { SubmitFunction } from "@sveltejs/kit";
import { problemBasicInfoSchema, type ProblemBasicInfo } from "@nojv/core";
import { superValidate, type SuperValidated } from "sveltekit-superforms";
import { zod4 } from "sveltekit-superforms/adapters";
import type { FormMessage } from "$lib/types/form-message";

const mocks = vi.hoisted(() => ({ enhanced: new Map<HTMLFormElement, SubmitFunction>() }));
vi.mock("$app/environment", () => ({
  browser: true,
  dev: true,
  building: false,
  version: "test",
}));
vi.mock("$app/navigation", () => ({
  beforeNavigate: vi.fn(),
  afterNavigate: vi.fn(),
  invalidateAll: vi.fn(),
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
  applyAction: vi.fn(),
}));
vi.mock("@lucide/svelte", async (importOriginal) => {
  const { default: Empty } = await import("../../fixtures/web/empty-component.svelte");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    CircleHelp: Empty,
    Eye: Empty,
    ImagePlus: Empty,
    Link: Empty,
    Pencil: Empty,
  };
});

import BasicInfoTab from "$lib/components/features/problem/tabs/BasicInfoTab.svelte";

const formData: SuperValidated<ProblemBasicInfo, FormMessage> = {
  id: "basic-info",
  valid: true,
  posted: false,
  errors: {},
  data: {
    title: "Guess",
    difficulty: "easy",
    statement: "Guess the number.",
    inputFormat: "",
    outputFormat: "One integer per guess.",
    interactionFormat: "Stored interaction notes",
    samples: [],
    tags: [],
  },
};

describe("BasicInfoTab", () => {
  it("keeps submitting stored interaction notes while the field is hidden", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(BasicInfoTab, {
      target,
      props: {
        formData,
        problemId: "prob_1",
        visibility: "private",
        adminMayPublish: false,
        judgeType: "standard",
      },
    });
    await tick();

    expect(target.querySelector('[name="interactionFormat"]')).toBeNull();
    const formElement = target.querySelector<HTMLFormElement>('form[action="?/update"]')!;
    const submit = mocks.enhanced.get(formElement)!;
    const submitted = new FormData(formElement);
    await submit({
      action: new URL(formElement.action),
      formData: submitted,
      formElement,
      controller: new AbortController(),
      submitter: null,
      cancel: vi.fn(),
    });

    const posted = await superValidate(submitted, zod4(problemBasicInfoSchema));
    expect(posted.data.interactionFormat).toBe("Stored interaction notes");

    await unmount(component);
    target.remove();
  });
});
