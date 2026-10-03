import { mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";

vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("../../fixtures/web/empty-component.svelte")).default;
  return { Eye: Empty, ImagePlus: Empty, Link: Empty, Pencil: Empty };
});
vi.mock("$lib/components/primitives/layout/MarkdownRenderer.svelte", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));

import ImageDropZone from "$lib/components/primitives/ui/ImageDropZone.svelte";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function openImport(target: HTMLElement) {
  target
    .querySelector<HTMLButtonElement>(`button[aria-label="${m.imageUpload_fromUrl()}"]`)!
    .click();
  await tick();
  const input = document.querySelector<HTMLInputElement>('input[type="url"]')!;
  input.value = "https://images.example/cat.png";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await tick();
  return input;
}

it.each([undefined, "problem-1"])(
  "imports a remote image into the appropriate owner scope (%s)",
  async (problemId) => {
    const target = document.body.appendChild(document.createElement("div"));
    const url = problemId
      ? "/api/storage/problem-images/problem-1/cat.png"
      : "/api/storage/user-content-images/author/cat.png";
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ url })));
    const component = mount(ImageDropZone, {
      target,
      props: { value: "Existing content", name: "content", problemId },
    });
    try {
      await tick();
      await openImport(target);
      const enter = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      document.querySelector<HTMLInputElement>('input[type="url"]')!.dispatchEvent(enter);
      expect(enter.defaultPrevented).toBe(true);
      await vi.waitFor(() =>
        expect(target.querySelector<HTMLTextAreaElement>("textarea")!.value).toContain(
          `![](${url})`,
        ),
      );
      const [endpoint, request] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(endpoint).toBe(
        problemId ? `/api/problems/${problemId}/images` : "/api/uploads/image",
      );
      expect(request.method).toBe("POST");
      expect((request.body as FormData).get("url")).toBe("https://images.example/cat.png");
      expect((request.body as FormData).has("image")).toBe(false);
      expect(target.querySelector<HTMLTextAreaElement>("textarea")!.value).toContain(
        "Existing content",
      );
      expect(document.querySelector('input[type="url"]')).toBeNull();
    } finally {
      await unmount(component);
      target.remove();
    }
  },
);

it("preserves author input and surfaces a failed remote import", async () => {
  const target = document.body.appendChild(document.createElement("div"));
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ message: "Image budget exceeded" }), { status: 409 }),
  );
  const component = mount(ImageDropZone, {
    target,
    props: { value: "Existing content", name: "content" },
  });
  try {
    await tick();
    const input = await openImport(target);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(target.querySelector('[role="alert"]')?.textContent).toBe("Image budget exceeded"),
    );
    expect(target.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
      "Existing content",
    );
    expect(input.value).toBe("https://images.example/cat.png");
  } finally {
    await unmount(component);
    target.remove();
  }
});
