import { mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SubmitFunction } from "@sveltejs/kit";
import { m } from "$lib/paraglide/messages.js";
import ExamPasswordLogin from "$lib/components/features/auth/ExamPasswordLogin.svelte";
import ExamCredentialsPanel from "$lib/components/features/course/exam/ExamCredentialsPanel.svelte";
import ExamHandInPanel from "$lib/components/features/course/exam/ExamHandInPanel.svelte";

const mocks = vi.hoisted(() => ({
  goto: vi.fn().mockResolvedValue(undefined),
  enhanced: new Map<HTMLFormElement, SubmitFunction>(),
}));
vi.mock("$app/navigation", () => ({ goto: mocks.goto }));
vi.mock("$app/forms", () => ({
  enhance(element: HTMLFormElement, submit?: SubmitFunction) {
    if (submit) mocks.enhanced.set(element, submit);
    return {
      destroy() {
        mocks.enhanced.delete(element);
      },
    };
  },
}));

let target: HTMLDivElement;
let component: ReturnType<typeof mount>;
beforeEach(() => {
  target = document.body.appendChild(document.createElement("div"));
  vi.clearAllMocks();
});
afterEach(async () => {
  if (component) await unmount(component);
  target.remove();
  vi.unstubAllGlobals();
  mocks.enhanced.clear();
});

async function fill(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await tick();
}

it("expands the password form and signs in with username to the returned exam", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ examId: "exam_example" })));
  vi.stubGlobal("fetch", fetchMock);
  component = mount(ExamPasswordLogin, { target });
  await tick();
  expect(target.querySelector("form")).toBeNull();
  const trigger = target.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!;
  expect(trigger.className).toContain("h-11");
  expect(trigger.className).toContain("border");
  trigger.click();
  await tick();
  await fill(target.querySelector('input[name="username"]')!, "example_student");
  await fill(target.querySelector('input[name="password"]')!, "ExampleOnlyPass123");
  target
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(mocks.goto).toHaveBeenCalledWith("/exams/exam_example", { invalidateAll: true }),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/auth/sign-in/exam-password",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ username: "example_student", password: "ExampleOnlyPass123" }),
    }),
  );
});

it("keeps the login form usable after an expired password response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
  component = mount(ExamPasswordLogin, { target });
  await tick();
  target.querySelector<HTMLButtonElement>("button")!.click();
  await tick();
  await fill(target.querySelector('input[name="username"]')!, "example_student");
  await fill(target.querySelector('input[name="password"]')!, "ExampleOnlyPass123");
  target
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(target.querySelector('[role="alert"]')?.textContent).toBe(
      m.auth_examPasswordInvalid(),
    ),
  );
  expect(mocks.goto).not.toHaveBeenCalled();
  expect(target.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
    false,
  );
});

const roster = [
  {
    membershipId: "member_a",
    userId: "student_a",
    username: "example_student",
    name: "Example Student",
    email: "example@example.test",
    password: "ExampleOnlyPass123",
    status: "email_sent" as const,
    emailSentAt: "2030-01-01T00:00:00Z",
    revision: 1,
  },
  {
    membershipId: "member_b",
    userId: null,
    username: "pending_student",
    name: "Pending Student",
    email: null,
    password: null,
    status: "pending_account" as const,
    emailSentAt: null,
    revision: null,
  },
];

it("shows roster credentials and IP reset even without an active session or violation", async () => {
  component = mount(ExamCredentialsPanel, {
    target,
    props: { rows: roster, startsAt: "2030-01-02T00:00:00Z", canEdit: true, canResetIp: true },
  });
  await tick();
  expect(target.textContent).toContain("ExampleOnlyPass123");
  expect(target.textContent).toContain(m.examCredentials_pendingAccount());
  const reset = target.querySelector('form[action="?/resetStudentIpBinding"]');
  expect(reset?.querySelector<HTMLInputElement>('input[name="targetUserId"]')?.value).toBe(
    "student_a",
  );
  expect(target.querySelectorAll('form[action="?/resetStudentIpBinding"]')).toHaveLength(1);
  const edit = [...target.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === m.examCredentials_edit(),
  )!;
  edit.click();
  await tick();
  const form = target.querySelector<HTMLFormElement>(
    'form[action="?/updateCredentialPassword"]',
  )!;
  expect(form.querySelector<HTMLInputElement>('input[name="userId"]')?.value).toBe("student_a");
  const input = form.querySelector<HTMLInputElement>('input[name="password"]')!;
  expect(input.minLength).toBe(12);
  expect(input.maxLength).toBe(64);
});

it("moves hand-in into a protected dialog with cancel initially focused", async () => {
  component = mount(ExamHandInPanel, { target, props: { examTitle: "Example exam" } });
  await tick();
  expect(document.querySelector('form[action="?/releaseSession"]')).toBeNull();
  target.querySelector<HTMLButtonElement>("button")!.click();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  const dialog = document.querySelector('[role="dialog"]')!;
  const cancel = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === m.examHandIn_keepWorking(),
  )!;
  await vi.waitFor(() => expect(document.activeElement).toBe(cancel));
  expect(dialog.textContent).toContain(m.examHandIn_unsentWarning());
  expect(dialog.querySelector('form[action="?/releaseSession"]')).not.toBeNull();
  cancel.click();
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
});

it("keeps password management available when only email delivery is unavailable", async () => {
  component = mount(ExamCredentialsPanel, {
    target,
    props: {
      rows: [{ ...roster[0]!, status: "email_unavailable" }],
      startsAt: "2030-01-02T00:00:00Z",
      canEdit: true,
      canResetIp: false,
    },
  });
  await tick();
  expect(target.textContent).toContain(m.examCredentials_emailUnavailable());
  expect(target.textContent).not.toContain(m.examCredentials_unavailable());
  expect(
    [...target.querySelectorAll("button")].some(
      (button) => button.textContent?.trim() === m.examCredentials_edit(),
    ),
  ).toBe(true);
});
