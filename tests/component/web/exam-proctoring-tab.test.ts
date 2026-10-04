// @vitest-environment jsdom
import { mount, tick, unmount } from "svelte";
import { expect, it, vi } from "vitest";

vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));

import ExamProctoringTab from "$lib/components/features/course/exam/ExamProctoringTab.svelte";

const violation = (id: string, userId: string) => ({
  id,
  userId,
  handle: userId,
  displayName: userId,
  violationType: "binding" as const,
  expectedIp: "203.0.113.10",
  actualIp: "198.51.100.20",
  createdAt: "2026-09-20T10:00:00.000Z",
});

it("offers one IP reset per blocked student even without an active session", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const tab = mount(ExamProctoringTab, {
    target,
    props: {
      canManage: true,
      activeSessions: [],
      violations: [
        violation("v1", "usr_a"),
        violation("v2", "usr_a"),
        violation("v3", "usr_b"),
      ],
    },
  });
  await tick();
  try {
    const forms = [...target.querySelectorAll('form[action="?/resetStudentIpBinding"]')];
    expect(
      forms.map((f) => f.querySelector<HTMLInputElement>('input[name="targetUserId"]')?.value),
    ).toEqual(["usr_a", "usr_b"]);
  } finally {
    await unmount(tab);
    target.remove();
  }
});

it("keeps sessions and violations readable without staff actions on an archived course", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const tab = mount(ExamProctoringTab, {
    target,
    props: {
      canManage: false,
      activeSessions: [
        {
          userId: "usr_a",
          displayName: "Student A",
          handle: "usr_a",
          startedAt: "2026-09-20T09:00:00.000Z",
        },
      ],
      violations: [violation("v1", "usr_a")],
    },
  });
  await tick();
  try {
    expect(target.textContent).toContain("Student A");
    expect(target.textContent).toContain("198.51.100.20");
    expect(target.querySelectorAll("form")).toHaveLength(0);
    expect(target.querySelectorAll("button")).toHaveLength(0);
  } finally {
    await unmount(tab);
    target.remove();
  }
});
