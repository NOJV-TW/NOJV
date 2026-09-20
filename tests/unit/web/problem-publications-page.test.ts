// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("$app/forms", () => ({ enhance: () => undefined }));
vi.mock("$app/navigation", () => ({ goto: vi.fn() }));
vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("./fixtures/empty-component.svelte")).default;
  return { FileCheck2: Empty };
});

import ProblemPublicationsPage from "../../../apps/web/src/routes/(app)/admin/problem-publications/+page.svelte";

const request = {
  id: "request-1",
  status: "pending" as const,
  reviewNote: null,
  createdAt: "2026-09-15T00:00:00.000Z",
  reviewedAt: null,
  problem: { id: "problem-1", displayId: 1, title: "Demo problem" },
  requester: { id: "user-1", username: "ta", name: "Teaching Assistant" },
  author: { id: "user-1", username: "ta", name: "Teaching Assistant" },
  publishedProblemId: null,
};

describe("problem publications page", () => {
  let component: ReturnType<typeof mount> | undefined;
  let target: HTMLDivElement;

  afterEach(async () => {
    if (component) await unmount(component);
    target?.remove();
  });

  it("shows an action error returned by the approval form", async () => {
    target = document.body.appendChild(document.createElement("div"));
    component = mount(ProblemPublicationsPage, {
      target,
      props: {
        data: { status: "all", nextCursor: null, requests: [request] },
        form: { error: "Problems require at least one testcase set before publishing." },
      },
    });
    await tick();

    expect(target.querySelector('[role="alert"]')?.textContent).toContain(
      "Problems require at least one testcase set before publishing.",
    );
  });
});
