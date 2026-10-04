import { mount, tick, unmount } from "svelte";
import { afterEach, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import MembersPage from "../../../apps/web/src/routes/(app)/courses/[courseId]/members/+page.svelte";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refresh: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: mocks.refresh }));
vi.mock("$app/forms", () => ({
  deserialize: JSON.parse,
  enhance: () => ({ destroy() {} }),
}));
vi.mock("$lib/stores/toast", () => ({
  toasts: { error: mocks.error, success: mocks.success },
}));
vi.mock("$lib/components/features/course/BulkHandleAddPanel.svelte", async () => ({
  default: (await import("../../fixtures/web/empty-component.svelte")).default,
}));
vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("../../fixtures/web/empty-component.svelte")).default;
  return {
    Check: Empty,
    ChevronDown: Empty,
    ChevronUp: Empty,
    ListFilter: Empty,
    Loader2: Empty,
    Pencil: Empty,
    Search: Empty,
    X: Empty,
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function member(overrides: Record<string, unknown>) {
  return {
    membershipId: "member-1",
    userId: "user-1",
    name: "Member",
    username: "member",
    image: null,
    email: null,
    role: "student",
    isPending: false,
    canCorrectUsername: false,
    canRemove: false,
    canChangeRole: false,
    joinedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function render(data: Record<string, unknown>) {
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(MembersPage, {
    target,
    props: { data: { isManager: true, canChangeRoles: true, ...data } as never },
  });
  return {
    target,
    async cleanup() {
      await unmount(component);
      target.remove();
    },
  };
}

async function chooseRole(target: HTMLElement, name: string, value: string) {
  const trigger = target.querySelector<HTMLButtonElement>(
    `[aria-label="${m.members_roleFor({ name })}"]`,
  );
  expect(trigger).not.toBeNull();
  trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await tick();
  const option = await vi.waitFor(() => {
    const item = document.querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`);
    expect(item).not.toBeNull();
    return item!;
  });
  option.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
  await tick();
}

it.each(["success", "failure"])("reports an HTTP 200 role change %s", async (type) => {
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue(
    Response.json({ type, status: type === "success" ? 200 : 403 }),
  );
  const view = render({
    canAssignTeacher: false,
    members: [member({ name: "Student", canChangeRole: true })],
  });
  try {
    await tick();
    await chooseRole(view.target, "Student", "ta");
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    expect(mocks.fetch.mock.calls[0]![0]).toBe("?/changeRole");
    expect(mocks.fetch.mock.calls[0]![1].body.get("role")).toBe("ta");
    if (type === "success") {
      await vi.waitFor(() =>
        expect(mocks.success).toHaveBeenCalledWith(m.members_roleChangeSuccess()),
      );
      expect(mocks.refresh).toHaveBeenCalledOnce();
      expect(mocks.error).not.toHaveBeenCalled();
    } else {
      await vi.waitFor(() =>
        expect(mocks.error).toHaveBeenCalledWith(m.members_roleChangeError()),
      );
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.success).not.toHaveBeenCalled();
    }
  } finally {
    await view.cleanup();
  }
});

it("offers the server-permitted actions on teacher rows", async () => {
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue(Response.json({ type: "success", status: 200 }));
  const view = render({
    canAssignTeacher: true,
    members: [
      member({
        membershipId: "teacher-1",
        name: "Co Teacher",
        role: "teacher",
        canChangeRole: true,
        canRemove: true,
      }),
      member({ membershipId: "owner-1", name: "Owner", role: "teacher" }),
    ],
  });
  try {
    await tick();
    const rows = [...view.target.querySelectorAll<HTMLElement>("tr[data-membership-id]")];
    const [coTeacher, owner] = rows;
    expect(
      coTeacher!.querySelector(`[aria-label="${m.members_roleFor({ name: "Co Teacher" })}"]`)
        ?.textContent,
    ).toContain(m.members_roleTeacher());
    expect(
      coTeacher!.querySelector(`button[aria-label="${m.members_removeAction()}"]`),
    ).not.toBeNull();
    expect(owner!.querySelector(`[aria-label="${m.members_roleFor({ name: "Owner" })}"]`)).toBe(
      null,
    );
    expect(owner!.textContent).toContain(m.members_roleTeacher());
    expect(owner!.querySelector(`button[aria-label="${m.members_removeAction()}"]`)).toBeNull();

    await chooseRole(view.target, "Co Teacher", "student");
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    expect(mocks.fetch.mock.calls[0]![1].body.get("membershipId")).toBe("teacher-1");
    expect(mocks.fetch.mock.calls[0]![1].body.get("role")).toBe("student");
  } finally {
    await view.cleanup();
  }
});

it("hides role controls the server would deny", async () => {
  const view = render({
    canAssignTeacher: false,
    members: [member({ name: "Locked", role: "ta" })],
  });
  try {
    await tick();
    expect(
      view.target.querySelector(`[aria-label="${m.members_roleFor({ name: "Locked" })}"]`),
    ).toBe(null);
    expect(view.target.textContent).toContain(m.members_roleTa());
  } finally {
    await view.cleanup();
  }
});
