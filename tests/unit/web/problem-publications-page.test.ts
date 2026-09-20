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
        data: { status: "pending", nextCursor: null, requests: [request] },
        form: { error: "Problems require at least one testcase set before publishing." },
      },
    });
    await tick();

    expect(target.querySelector('[role="alert"]')?.textContent).toContain(
      "Problems require at least one testcase set before publishing.",
    );
  });

  it("renders separate pending and closed request tabs with pending selected by default", async () => {
    target = document.body.appendChild(document.createElement("div"));
    component = mount(ProblemPublicationsPage, {
      target,
      props: {
        data: { status: "pending", nextCursor: null, requests: [request] },
        form: null,
      },
    });
    await tick();

    expect(target.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe(
      "/admin/problem-publications",
    );
    expect(
      target.querySelector('a[href="/admin/problem-publications?status=closed"]'),
    ).not.toBeNull();
  });

  it("shows approved and rejected requests in the closed view without review actions", async () => {
    target = document.body.appendChild(document.createElement("div"));
    const approved = {
      ...request,
      id: "approved-request",
      status: "approved" as const,
      reviewedAt: "2026-09-16T00:00:00.000Z",
      publishedProblemId: "public-problem-1",
    };
    const rejected = {
      ...request,
      id: "rejected-request",
      status: "rejected" as const,
      reviewedAt: "2026-09-16T00:00:00.000Z",
      reviewNote: "Please add a statement.",
    };

    component = mount(ProblemPublicationsPage, {
      target,
      props: {
        data: { status: "closed", nextCursor: null, requests: [approved, rejected] },
        form: null,
      },
    });
    await tick();

    expect(target.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(target.querySelectorAll("form")).toHaveLength(0);
    expect(target.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe(
      "/admin/problem-publications?status=closed",
    );
  });
});
