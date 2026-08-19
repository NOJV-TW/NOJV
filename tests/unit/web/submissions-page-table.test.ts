// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("./fixtures/empty-component.svelte")).default;
  return { Code2: Empty, History: Empty, Loader2: Empty };
});

vi.mock("$lib/stores/sse", () => ({ watchSubmissionVerdict: () => () => undefined }));
vi.mock("$lib/components/primitives/ui/EmptyState.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/primitives/ui/button", async () => ({
  Button: (await import("./fixtures/empty-component.svelte")).default,
}));

describe("submissions page", () => {
  it("uses a table with problem, language, and verdict filters in its headers", async () => {
    const { default: SubmissionsPage } =
      await import("../../../apps/web/src/routes/(app)/submissions/+page.svelte");
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(SubmissionsPage, {
      target,
      props: {
        data: {
          nextCursor: null,
          submissions: [
            {
              id: "sub_1",
              createdAt: "2026-08-20T08:00:00.000Z",
              language: "cpp",
              problemId: "p1",
              problemTitle: "A + B",
              runtimeMs: 12,
              memoryKb: 1024,
              score: 100,
              totalScore: 100,
              status: "accepted",
              context: "assignment",
            },
          ],
        },
      },
    });

    expect(target.querySelector("table")).not.toBeNull();
    for (const label of ["Problem", "Language", "Verdict"]) {
      expect(target.querySelector(`[aria-label="${label}"]`)?.closest("th")).not.toBeNull();
    }

    await unmount(component);
    target.remove();
  });
});
