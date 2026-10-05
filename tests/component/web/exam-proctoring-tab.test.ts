// @vitest-environment jsdom
import { mount, tick, unmount, type ComponentProps } from "svelte";
import { afterEach, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";

vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock("$lib/components/primitives/ui/select/select-content.svelte", async () => ({
  default: (await import("../../fixtures/web/select-content.svelte")).default,
}));

import ExamProctoringTab from "$lib/components/features/course/exam/ExamProctoringTab.svelte";

const student = (userId: string) => ({
  membershipId: `member_${userId}`,
  userId,
  username: userId,
  name: userId,
  email: null,
  password: null,
  status: "not_issued" as const,
  emailSentAt: null,
  revision: null,
});

const session = (userId: string) => ({
  userId,
  displayName: userId,
  handle: userId,
  startedAt: "2026-09-20T09:00:00.000Z",
});

const violation = (
  id: string,
  userId: string,
  actualIp = "198.51.100.20",
  violationType: "binding" | "whitelist" = "binding",
) => ({
  id,
  userId,
  handle: userId,
  displayName: userId,
  violationType,
  expectedIp: "203.0.113.10",
  actualIp,
  createdAt: "2026-09-20T10:00:00.000Z",
});

const proctored = (
  userId: string,
  overrides: { submittedAt?: string; ipPin?: string; leaveAttempts?: number } = {},
) => ({
  userId,
  submittedAt: overrides.submittedAt ?? null,
  ipPin: overrides.ipPin ?? null,
  leaveAttempts: overrides.leaveAttempts ?? 0,
});

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | undefined;
afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  target.remove();
});

function render(props: Partial<ComponentProps<typeof ExamProctoringTab>> = {}) {
  target = document.body.appendChild(document.createElement("div"));
  component = mount(ExamProctoringTab, {
    target,
    props: {
      roster: [student("usr_a"), student("usr_b"), student("usr_c")],
      violations: [],
      activeSessions: [],
      proctoring: [],
      passwordEnabled: false,
      pageLockEnabled: false,
      ipBindingEnabled: false,
      canManage: true,
      canRegenerate: true,
      ...props,
    },
  });
  return tick();
}

const targetsOf = (action: string) =>
  [...target.querySelectorAll(`form[action="?/${action}"]`)].map(
    (form) => form.querySelector<HTMLInputElement>('input[name="targetUserId"]')?.value,
  );

const visibleStudents = () =>
  [...target.querySelectorAll("tbody td:first-child p.font-medium")].map((cell) =>
    cell.textContent?.trim(),
  );

async function choose(label: string, value: string) {
  const trigger = target.querySelector(`[aria-label="${label}"]`)!;
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await tick();
  const option = await vi.waitFor(() => {
    const item = trigger.closest("th")!.querySelector(`[role="option"][data-value="${value}"]`);
    expect(item).not.toBeNull();
    return item!;
  });
  option.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
  await tick();
}

it("puts one IP reset on each student still in play with a bound IP or violations", async () => {
  await render({
    roster: [student("usr_a"), student("usr_b"), student("usr_c"), student("usr_d")],
    violations: [violation("v2", "usr_a"), violation("v1", "usr_a")],
    proctoring: [
      proctored("usr_b", { ipPin: "203.0.113.9" }),
      proctored("usr_d", { ipPin: "203.0.113.8", submittedAt: "2026-09-20T11:00:00.000Z" }),
    ],
    activeSessions: [session("usr_c")],
  });
  expect(targetsOf("resetStudentIpBinding")).toEqual(["usr_a", "usr_b"]);
  expect(targetsOf("releaseStudentSession")).toEqual([]);
  expect(target.querySelector("thead th:last-child")?.textContent?.trim()).toBe(
    m.examProctoring_colActions(),
  );
});

it.each([true, false])(
  "shows page-lock leave attempts and lifting only when the exam locks pages (%s)",
  async (pageLockEnabled) => {
    await render({
      activeSessions: [session("usr_a")],
      proctoring: [proctored("usr_a", { leaveAttempts: 3 })],
      pageLockEnabled,
    });
    expect(targetsOf("releaseStudentSession")).toEqual(pageLockEnabled ? ["usr_a"] : []);
    expect(target.querySelector('form[action="?/releaseAllSessions"]')).toBeNull();
    expect(
      target.querySelector("thead")?.textContent?.includes(m.examProctoring_colLeaves()),
    ).toBe(pageLockEnabled);
    expect(target.querySelector("tbody tr")?.textContent?.includes("3")).toBe(pageLockEnabled);
  },
);

it.each([true, false])(
  "shows bound IPs only under IP binding (%s)",
  async (ipBindingEnabled) => {
    await render({
      proctoring: [proctored("usr_a", { ipPin: "203.0.113.9" })],
      ipBindingEnabled,
    });
    expect(target.textContent?.includes("203.0.113.9")).toBe(ipBindingEnabled);
  },
);

it("shows the latest violation in the row and the full history in a popover", async () => {
  await render({
    violations: [
      violation("v2", "usr_a"),
      violation("v1", "usr_a", "198.51.100.7", "whitelist"),
    ],
  });
  expect(target.textContent).toContain("203.0.113.10 → 198.51.100.20");
  expect(target.textContent).not.toContain("198.51.100.7");
  const history = target.querySelector<HTMLButtonElement>(
    `[aria-label="${m.examProctoring_violationHistory({ count: 2 })}"]`,
  )!;
  expect(history.textContent?.trim()).toBe("×2");
  history.click();
  await vi.waitFor(() => expect(document.body.textContent).toContain("198.51.100.7"));
  expect(document.body.textContent).toContain(m.examProctoring_typeWhitelist());
});

it("filters students from the column headers", async () => {
  await render({
    roster: [student("usr_a"), student("usr_b"), student("usr_c"), student("usr_d")],
    violations: [violation("v1", "usr_a")],
    activeSessions: [session("usr_b")],
    proctoring: [proctored("usr_d", { submittedAt: "2026-09-20T11:00:00.000Z" })],
  });
  expect(target.textContent).toContain(m.examProctoring_submitted());
  await choose(m.examProctoring_colIp(), "violation");
  expect(visibleStudents()).toEqual(["usr_a"]);
  await choose(m.examProctoring_colIp(), "");
  await choose(m.examProctoring_colSession(), "submitted");
  expect(visibleStudents()).toEqual(["usr_d"]);
  await choose(m.examProctoring_colSession(), "idle");
  expect(visibleStudents()).toEqual(["usr_a", "usr_c"]);

  target
    .querySelector<HTMLButtonElement>(`[aria-label="${m.examCredentials_search()}"]`)!
    .click();
  const input = await vi.waitFor(() => {
    const field = document.querySelector<HTMLInputElement>("#exam-proctoring-student-filter");
    expect(field).not.toBeNull();
    return field!;
  });
  input.value = "USR_C";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.waitFor(() => expect(visibleStudents()).toEqual(["usr_c"]));

  await choose(m.examProctoring_colSession(), "active");
  expect(visibleStudents()).toEqual([]);
  expect(target.textContent).toContain(m.examCredentials_noMatches());
});

it("keeps everything readable without staff actions on an archived course", async () => {
  await render({
    roster: [{ ...student("usr_a"), password: "ExampleOnly1", status: "email_sent" }],
    activeSessions: [session("usr_a")],
    violations: [violation("v1", "usr_a")],
    passwordEnabled: true,
    pageLockEnabled: true,
    canManage: false,
    canRegenerate: false,
  });
  expect(target.textContent).toContain("ExampleOnly1");
  expect(target.textContent).toContain("198.51.100.20");
  expect(target.textContent).toContain(m.examProctoring_inExam());
  expect(target.querySelectorAll("form")).toHaveLength(0);
  expect(target.textContent).not.toContain(m.examProctoring_colActions());
});
