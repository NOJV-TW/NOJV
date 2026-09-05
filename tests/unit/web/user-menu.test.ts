// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";

const { page } = vi.hoisted(() => ({
  page: {
    data: {
      user: {
        id: "user_1",
        name: "Teacher",
        username: "teacher",
        email: "teacher@example.test",
        platformRole: "admin",
        isSuperAdmin: false,
        twoFactorEnabled: true,
        image: null,
      },
      session: { id: "session_1" },
      adminAccessActive: false,
    },
    url: new URL("http://localhost/dashboard"),
  },
}));
vi.mock("$app/state", () => ({ page }));
vi.mock("$lib/auth.client", () => ({
  authClient: { signOut: vi.fn(), passkey: { listUserPasskeys: vi.fn() } },
}));
vi.mock("$lib/components/features/account/StepUpDialog.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
import UserMenu from "$lib/components/features/auth/UserMenu.svelte";

let target: HTMLDivElement;
let component: ReturnType<typeof mount>;
beforeEach(() => {
  page.data.user.isSuperAdmin = false;
  target = document.createElement("div");
  document.body.append(target);
});
afterEach(async () => {
  await unmount(component);
  target.remove();
});

async function openMenu() {
  component = mount(UserMenu, { target });
  const trigger = target.querySelector<HTMLButtonElement>("button")!;
  await vi.waitFor(() => expect(trigger.disabled).toBe(false));
  trigger.focus();
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
  return trigger;
}

describe("UserMenu keyboard behavior", () => {
  it("navigates items and restores focus on Escape", async () => {
    const trigger = await openMenu();
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    await vi.waitFor(() => expect(document.activeElement).toBe(items[0]));
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(items[1]));
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(items.at(-1)));
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await vi.waitFor(() => {
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("does not expose the admin mode toggle to a super admin", async () => {
    page.data.user.isSuperAdmin = true;
    await openMenu();
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain(
      m.userMenu_enterAdminMode(),
    );
  });
});
