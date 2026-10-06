// @vitest-environment jsdom

import { flushSync, mount, unmount } from "svelte";
import { describe, expect, it } from "vitest";

import SamplesEditor from "$lib/components/features/problem/statement/SamplesEditor.svelte";
import { m } from "$lib/paraglide/messages.js";

function mountEditor(judgeType: "interactive" | "standard") {
  const target = document.createElement("div");
  document.body.append(target);
  let samples = [
    { input: "1 1000000", output: "? 500000", interactorInput: "424242" },
    { input: "1 1000000", output: "? 1", interactorInput: "1" },
  ];
  const component = mount(SamplesEditor, {
    target,
    props: {
      get samples() {
        return samples;
      },
      set samples(next) {
        samples = next;
      },
      judgeType,
    },
  });
  return { target, component, samples: () => samples };
}

function labelledAll(target: HTMLElement, text: string) {
  return [...target.querySelectorAll("label")].filter(
    (label) => label.querySelector("span")?.textContent?.trim().startsWith(text) === true,
  );
}

function labelled(target: HTMLElement, text: string) {
  return labelledAll(target, text)[0];
}

describe("SamplesEditor", () => {
  it("asks for a required interactor input and labels the transcript on an interactive problem", async () => {
    const { target, component, samples } = mountEditor("interactive");

    const field = labelled(target, m.admin_sampleInteractorInput())?.querySelector("textarea");
    expect(field?.required).toBe(true);
    expect(field?.value).toBe("424242");
    const help = document.getElementById(field?.getAttribute("aria-describedby") ?? "");
    expect(help?.textContent).toContain(m.admin_sampleInteractorInputHelp());
    const describedBy = labelledAll(target, m.admin_sampleInteractorInput()).map((label) =>
      label.querySelector("textarea")?.getAttribute("aria-describedby"),
    );
    expect(describedBy).toEqual([help?.id, help?.id]);
    expect(target.textContent.split(m.admin_sampleInteractorInputHelp())).toHaveLength(2);
    expect(labelled(target, m.admin_sampleTranscriptInteractor())).toBeDefined();
    expect(labelled(target, m.admin_sampleTranscriptProgram())).toBeDefined();

    field!.value = "7";
    field!.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(samples()[0]?.interactorInput).toBe("7");

    await unmount(component);
    target.remove();
  });

  it("keeps the plain sample fields on a standard problem", async () => {
    const { target, component } = mountEditor("standard");

    expect(target.textContent).not.toContain(m.admin_sampleInteractorInput());
    expect(target.textContent).not.toContain(m.admin_sampleTranscriptInteractor());
    expect(labelled(target, m.admin_sampleInput())).toBeDefined();
    expect(labelled(target, m.admin_sampleOutput())).toBeDefined();
    expect(target.querySelectorAll("textarea")).toHaveLength(6);

    await unmount(component);
    target.remove();
  });
});
