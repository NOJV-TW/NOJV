// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { expect, it, vi } from "vitest";
import { m } from "#lib/paraglide/messages.js";
import Report from "#lib/components/features/plagiarism/AssignmentPlagiarismReport.svelte";

vi.mock("#lib/components/primitives/ui/button/index.js", async () => ({
  Button: (await import("./fixtures/component-button.svelte")).default,
  LinkButton: (await import("./fixtures/component-button.svelte")).default,
}));

it("starts an exam check, shows the pending state and polls the completed report", async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({}, { status: 202 }))
    .mockResolvedValueOnce(
      Response.json({ reports: [{ status: "completed", results: { pairs: [] } }] }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const target = document.createElement("div");
  const component = mount(Report, {
    target,
    props: {
      report: null,
      students: [],
      problems: [],
      diffContext: { type: "exam", id: "exam1" },
    },
  });
  try {
    expect(target.textContent).toContain(m.plagiarism_examNotRun());
    target.querySelector("button")!.click();
    await vi.advanceTimersByTimeAsync(0);
    await tick();
    expect(target.textContent).toContain(m.assignmentDetail_plagStatusPending());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/plagiarism/exam1/reports?type=exam",
      expect.objectContaining({ method: "POST", headers: { "X-Requested-With": "fetch" } }),
    );
    await vi.advanceTimersByTimeAsync(2000);
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(target.textContent).toContain(m.assignmentDetail_plagTotal());
  } finally {
    await unmount(component);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

it("shows the final report on an open exam tab without starting a second check", async () => {
  vi.useFakeTimers();
  const deadline = Date.now();
  const fetchMock = vi.fn().mockResolvedValue(
    Response.json({
      reports: [
        {
          status: "completed",
          triggeredAt: new Date(deadline).toISOString(),
          results: { pairs: [] },
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const target = document.createElement("div");
  const component = mount(Report, {
    target,
    props: {
      report: null,
      students: [],
      problems: [],
      closedExamAt: deadline,
      diffContext: { type: "exam", id: "exam1" },
    },
  });
  try {
    await tick();
    await vi.advanceTimersByTimeAsync(15000);
    await tick();
    expect(target.textContent).toContain(m.assignmentDetail_plagTotal());
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("method", "POST");
  } finally {
    await unmount(component);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
