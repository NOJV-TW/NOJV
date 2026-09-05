// @vitest-environment jsdom

import { mount, unmount, tick } from "svelte";
import { expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";

vi.mock("@lucide/svelte", async () => {
  const icon = (await import("./fixtures/empty-component.svelte")).default;
  return { Flag: icon, Trash2: icon };
});
vi.mock("$lib/components/primitives/ui/ConfirmDialog.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/posts/ReportDialog.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
import CommentSection from "$lib/components/features/posts/CommentSection.svelte";

it("reports a refresh failure after a successful comment submission", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json([
        {
          id: "comment_1",
          parentId: null,
          content: "Existing comment",
          createdAt: new Date().toISOString(),
          authorId: "other",
          author: { name: "Teacher" },
          deleted: false,
        },
      ]),
    )
    .mockResolvedValueOnce(new Response(null, { status: 201 }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(CommentSection, {
    target,
    props: { postId: "post_1", type: "discussion", viewerId: "user_1", isAdmin: false },
  });
  try {
    await vi.waitFor(() => expect(target.textContent).toContain("Existing comment"));
    const input = target.querySelector("textarea")!;
    input.value = "New comment";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    const submit = [...target.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === m.posts_commentSubmit(),
    )!;
    submit.click();
    await vi.waitFor(() =>
      expect(target.querySelector('[role="alert"]')?.textContent).toBe(m.posts_loadError()),
    );
    expect(target.textContent).toContain("Existing comment");
  } finally {
    await unmount(component);
    target.remove();
    vi.unstubAllGlobals();
  }
});
