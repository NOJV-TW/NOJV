// @vitest-environment jsdom

import { flushSync, mount, unmount } from "svelte";
import { describe, expect, it } from "vitest";

import SamplesEditor from "$lib/components/features/problem/statement/SamplesEditor.svelte";
import { m } from "$lib/paraglide/messages.js";

function mountEditor(judgeType: "interactive" | "standard") {
  const target = document.createElement("div");
  document.body.append(target);
  let samples = [{ input: "1 1000000", output: "? 500000", interactorInput: "424242" }];
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

function labelled(target: HTMLElement, text: string) {
  return [...target.querySelectorAll("label")].find(
    (label) => label.querySelector("span")?.textContent?.trim().startsWith(text) === true,
  );
}

describe("SamplesEditor", () => {
  it("asks for a required interactor input and labels the transcript on an interactive problem", async () => {
    const { target, component, samples } = mountEditor("interactive");

    const field = labelled(target, m.problemEditor_sampleInteractorInput())?.querySelector(
      "textarea",
    );
    expect(field?.required).toBe(true);
    expect(field?.value).toBe("424242");
    const help = document.getElementById(field?.getAttribute("aria-describedby") ?? "");
    expect(help?.textContent).toContain(m.problemEditor_sampleInteractorInputHelp());
    expect(labelled(target, m.problemEditor_sampleTranscriptInteractor())).toBeDefined();
    expect(labelled(target, m.problemEditor_sampleTranscriptProgram())).toBeDefined();

    field!.value = "7";
    field!.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(samples()[0]?.interactorInput).toBe("7");

    await unmount(component);
    target.remove();
  });

  it("keeps the plain sample fields on a standard problem", async () => {
    const { target, component } = mountEditor("standard");

    expect(target.textContent).not.toContain(m.problemEditor_sampleInteractorInput());
    expect(target.textContent).not.toContain(m.problemEditor_sampleTranscriptInteractor());
    expect(labelled(target, m.admin_sampleInput())).toBeDefined();
    expect(labelled(target, m.admin_sampleOutput())).toBeDefined();
    expect(target.querySelectorAll("textarea")).toHaveLength(3);

    await unmount(component);
    target.remove();
  });
});
