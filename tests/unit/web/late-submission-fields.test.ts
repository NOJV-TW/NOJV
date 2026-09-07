// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { writable } from "svelte/store";
import { assessmentSettingsFormSchema } from "@nojv/core";
import AssignmentBasicSection from "$lib/components/features/course/assignment/AssignmentBasicSection.svelte";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import LateSubmissionFields from "$lib/components/features/course/LateSubmissionFields.svelte";

let target: HTMLDivElement;
let component: ReturnType<typeof mount>;
beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
});
afterEach(async () => {
  if (component) await unmount(component);
  target.remove();
});

const initial = {
  dueAt: "2026-09-10T10:00",
  finalAt: "2026-09-10T10:10",
  allowLateSubmissions: false,
  latePenalty: null,
  finalName: "endsAt" as const,
  exam: true,
};

describe("LateSubmissionFields", () => {
  it("reveals final collection and penalty together, clears penalties when late submissions are disabled", async () => {
    component = mount(LateSubmissionFields, { target, props: initial });
    const toggle = target.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(target.querySelector("#endsAt")).toBeNull();
    expect(target.querySelector("select")).toBeNull();
    toggle.click();
    await tick();
    expect(target.querySelector<HTMLInputElement>("#endsAt")?.required).toBe(true);
    expect(target.querySelector<HTMLInputElement>("#endsAt")?.min).toBe(initial.dueAt);
    const select = target.querySelector<HTMLSelectElement>("select")!;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "none",
      "flat_late_penalty",
      "daily_late_penalty",
    ]);
    select.value = "daily_late_penalty";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    expect(target.textContent).toContain(m.latePenalty_dailyHint());
    expect(target.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe("10");
    toggle.click();
    await tick();
    expect(target.querySelector("#endsAt")).toBeNull();
    toggle.click();
    await tick();
    expect(target.querySelector<HTMLSelectElement>("select")?.value).toBe("none");
    const accessibility = await axe.run(target, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(accessibility.violations).toEqual([]);
  });

  it("keeps running exam policy locked while allowing deadline extensions", () => {
    component = mount(LateSubmissionFields, {
      target,
      props: {
        ...initial,
        allowLateSubmissions: true,
        editablePolicy: false,
        editableEnd: true,
        editableDue: true,
      },
    });
    expect(target.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(
      true,
    );
    expect(target.querySelector<HTMLSelectElement>("select")?.disabled).toBe(true);
    expect(target.querySelector<HTMLInputElement>("#dueAt")?.disabled).toBe(false);
    expect(target.querySelector<HTMLInputElement>("#endsAt")?.disabled).toBe(false);
  });

  it("explains why percentage penalties are unavailable in problem-count mode", () => {
    component = mount(LateSubmissionFields, {
      target,
      props: { ...initial, allowLateSubmissions: true, pointsBased: false },
    });
    expect(target.querySelector<HTMLSelectElement>("select")?.disabled).toBe(true);
    expect(target.textContent).toContain(m.lateSubmission_pointsOnly());
  });
  it("locks an open assignment policy while retaining deadline extension and basic edits", () => {
    const form = writable(
      assessmentSettingsFormSchema.parse({
        title: "Assignment",
        opensAt: "2026-09-10T09:00",
        dueAt: initial.dueAt,
        closesAt: initial.finalAt,
        allowLateSubmissions: true,
        latePenalty: { type: "daily_late_penalty", perDayPct: 10 },
      }),
    );
    component = mount(AssignmentBasicSection, {
      target,
      props: {
        form,
        errors: writable({}),
        editableBasics: true,
        editableOpensAt: false,
        editableDeadlines: true,
      },
    });
    expect(target.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(
      true,
    );
    expect(target.querySelector<HTMLSelectElement>("select")?.disabled).toBe(true);
    expect(target.querySelector<HTMLInputElement>('input[type="number"]')?.disabled).toBe(true);
    expect(target.querySelector<HTMLInputElement>("#dueAt")?.disabled).toBe(false);
    expect(target.querySelector<HTMLInputElement>("#closesAt")?.disabled).toBe(false);
    expect(target.querySelector<HTMLInputElement>("#settings-title")?.disabled).toBe(false);
  });
});
