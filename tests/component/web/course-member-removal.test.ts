import { mount, tick, unmount } from "svelte";
import { afterEach, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import MembersPage from "../../../apps/web/src/routes/(app)/courses/[courseId]/members/+page.svelte";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn(), error: vi.fn() }));
vi.mock("$app/navigation", () => ({ invalidateAll: mocks.refresh }));
vi.mock("$app/forms", () => ({
  deserialize: JSON.parse,
  enhance: () => ({ destroy() {} }),
}));
vi.mock("$lib/stores/toast", () => ({ toasts: { error: mocks.error } }));
vi.mock("$lib/components/features/course/BulkHandleAddPanel.svelte", async () => ({
  default: (await import("../../unit/web/fixtures/empty-component.svelte")).default,
}));
vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("../../unit/web/fixtures/empty-component.svelte")).default;
  return {
    Pencil: Empty,
    X: Empty,
    Loader2: Empty,
    Search: Empty,
    ChevronDown: Empty,
    ListFilter: Empty,
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it.each(["success", "failure"])(
  "handles an HTTP 200 action %s after confirmation",
  async (type) => {
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValue(
      Response.json({ type, status: type === "success" ? 200 : 403 }),
    );
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(MembersPage, {
      target,
      props: {
        data: {
          isManager: true,
          members: [
            {
              membershipId: "member-1",
              userId: null,
              name: "student",
              username: "student",
              image: null,
              email: null,
              role: "student",
              isPending: true,
              canCorrectUsername: false,
              canRemove: true,
              joinedAt: "2026-09-01T00:00:00.000Z",
            },
          ],
        } as never,
      },
    });
    try {
      await tick();
      target
        .querySelector<HTMLButtonElement>(`button[aria-label="${m.members_removeAction()}"]`)!
        .click();
      await tick();
      expect(mocks.fetch).not.toHaveBeenCalled();
      const confirm = [
        ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
      ].find((button) => button.textContent?.trim() === m.members_removeAction());
      expect(confirm).toBeDefined();
      confirm!.click();
      await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
      expect(mocks.fetch.mock.calls[0]![0]).toBe("?/remove");
      expect(mocks.fetch.mock.calls[0]![1].body.get("membershipId")).toBe("member-1");
      if (type === "success") {
        await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
        expect(mocks.error).not.toHaveBeenCalled();
      } else {
        await vi.waitFor(() =>
          expect(mocks.error).toHaveBeenCalledWith(m.members_removeError()),
        );
        expect(mocks.refresh).not.toHaveBeenCalled();
      }
    } finally {
      await unmount(component);
      target.remove();
    }
  },
);
