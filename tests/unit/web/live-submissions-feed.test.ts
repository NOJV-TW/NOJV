// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { describe, expect, it } from "vitest";

import LiveSubmissionsFeed from "$lib/components/features/coursework/LiveSubmissionsFeed.svelte";

const rows = [
  {
    id: "sub_1",
    createdAt: "2026-08-20T08:00:00.000Z",
    ipAddress: "203.0.113.10",
    language: "cpp" as const,
    score: 100,
    status: "accepted",
    problem: { id: "p1", title: "A + B" },
    user: { id: "u1", name: "Alice", username: "student01" },
  },
  {
    id: "sub_2",
    createdAt: "2026-08-20T08:01:00.000Z",
    ipAddress: "203.0.113.22",
    language: "python" as const,
    score: 0,
    status: "wrong_answer",
    problem: { id: "p2", title: "Graph" },
    user: { id: "u2", name: "Bob", username: "student02" },
  },
];

describe("LiveSubmissionsFeed", () => {
  it("combines verdict, language, problem, student number, and IP filters", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(LiveSubmissionsFeed, { target, props: { rows } });

    const table = target.querySelector("table");
    const search = target.querySelector('[aria-label="Search student number or IP"]');
    expect(search?.compareDocumentPosition(table!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );
    for (const label of ["Verdict", "Language", "Problem"]) {
      expect(target.querySelector(`[aria-label="${label}"]`)?.closest("th")).not.toBeNull();
    }

    const setValue = async (selector: string, value: string) => {
      const control = target.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
      expect(control).not.toBeNull();
      control!.value = value;
      control!.dispatchEvent(
        new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
      );
      await tick();
    };

    await setValue('[aria-label="Verdict"]', "accepted");
    await setValue('[aria-label="Language"]', "cpp");
    await setValue('[aria-label="Problem"]', "p1");
    await setValue('[aria-label="Search student number or IP"]', "203.0.113.10");

    expect(target.textContent).toContain("student01");
    expect(target.textContent).not.toContain("student02");

    await setValue('[aria-label="Search student number or IP"]', "student02");
    expect(target.textContent).not.toContain("student01");
    expect(target.textContent).not.toContain("student02");

    await unmount(component);
    target.remove();
  });
});
