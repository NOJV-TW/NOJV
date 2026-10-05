import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import UsersTable from "$lib/components/features/admin/users/UsersTable.svelte";

vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock("$lib/components/primitives/ui/select/select-content.svelte", async () => ({
  default: (await import("../../fixtures/web/select-content.svelte")).default,
}));
vi.mock("$lib/stores/toast", () => ({ toasts: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("../../fixtures/web/empty-component.svelte")).default;
  return {
    ArrowDown: (await import("../../fixtures/web/arrow-down-icon.svelte")).default,
    ArrowUp: (await import("../../fixtures/web/arrow-up-icon.svelte")).default,
    ArrowUpDown: (await import("../../fixtures/web/arrow-up-down-icon.svelte")).default,
    Ban: Empty,
    Check: Empty,
    ChevronDown: Empty,
    ChevronUp: Empty,
    CircleCheck: Empty,
    ListFilter: Empty,
    Search: Empty,
    Trash2: Empty,
    UserCog: Empty,
    X: Empty,
  };
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function render(overrides: Record<string, unknown> = {}) {
  const target = document.createElement("div");
  document.body.append(target);
  const props = {
    users: [],
    actorId: "admin",
    canManageAdmins: true,
    usernameFilter: "",
    emailFilter: "",
    nameFilter: "",
    roleFilter: "",
    statusFilter: "",
    createdAtOrder: "desc",
    onApply: vi.fn(),
    ...overrides,
  };
  const instance = mount(UsersTable, { target, props: props as never });
  cleanups.push(async () => {
    await unmount(instance);
    target.remove();
  });
  return target;
}

async function pickOption(target: HTMLElement, label: string, value: string) {
  target
    .querySelector<HTMLButtonElement>(`th button[aria-label="${label}"]`)!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await tick();
  const option = await vi.waitFor(() => {
    const item = document.querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`);
    expect(item).not.toBeNull();
    return item!;
  });
  option.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
  await tick();
}

it("applies the role filter picked from the column header", async () => {
  const onApply = vi.fn();
  const target = render({ onApply });

  await pickOption(target, m.admin_usersFilterRole(), "teacher");

  expect(onApply).toHaveBeenCalledOnce();
  expect(
    target.querySelector(`[aria-label="${m.admin_usersFilterRole()}"]`)?.textContent,
  ).toContain(m.common_roleTeacher());
});

it("clears an active status filter and re-applies", async () => {
  const onApply = vi.fn();
  const target = render({ statusFilter: "disabled", onApply });
  const trigger = target.querySelector(`[aria-label="${m.admin_usersFilterStatus()}"]`);
  const clear = () =>
    target.querySelector<HTMLButtonElement>(
      `button[aria-label="${m.common_clearFilter({ label: m.admin_usersStatus() })}"]`,
    );

  expect(trigger?.textContent).toContain(m.admin_usersStatusDisabled());
  clear()!.click();
  await tick();

  expect(onApply).toHaveBeenCalledOnce();
  expect(trigger?.textContent).toContain(m.admin_usersStatus());
  expect(clear()).toBeNull();
});

it("flips the created sort from the column header", async () => {
  const onApply = vi.fn();
  const target = render({ onApply });
  const header = () =>
    [...target.querySelectorAll("th")].find(
      (th) => th.textContent?.trim() === m.admin_usersCreated(),
    )!;

  expect(header().getAttribute("aria-sort")).toBe("descending");
  header().querySelector("button")!.click();
  flushSync();

  expect(onApply).toHaveBeenCalledOnce();
  expect(header().getAttribute("aria-sort")).toBe("ascending");
  expect(header().querySelector('[data-icon="up"]')).not.toBeNull();
});
