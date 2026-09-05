// @vitest-environment jsdom

import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import { mount, tick, unmount } from "svelte";
import { beforeEach, expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";

const mocks = vi.hoisted(() => ({
  forms: new Map<string, SubmitFunction>(),
  toastError: vi.fn(),
}));
vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    mocks.forms.set(form.getAttribute("action")!, submit);
    return { destroy() {} };
  },
}));
vi.mock("$lib/stores/toast", () => ({ toasts: { error: mocks.toastError } }));
vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("./fixtures/empty-component.svelte")).default;
  return {
    AlertCircle: Empty,
    ArrowRight: Empty,
    CalendarClock: Empty,
    ChevronRight: Empty,
    ClipboardList: Empty,
    Megaphone: Empty,
    Pencil: Empty,
    Pin: Empty,
    Plus: Empty,
    Trash2: Empty,
  };
});
vi.mock("$lib/components/primitives/ui/ImageDropZone.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/features/announcement/AnnouncementViewDialog.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));

import CourseAnnouncementDialog from "$lib/components/features/course/CourseAnnouncementDialog.svelte";
import CoursePage from "../../../apps/web/src/routes/(app)/courses/[courseId]/+page.svelte";

const announcement = {
  id: "ann1",
  title: "Keep this title",
  content: "Keep this content",
  pinned: false,
  expiresAt: null,
  createdAt: "2026-09-01T00:00:00Z",
};
const failure: ActionResult = {
  type: "failure",
  status: 500,
  data: { error: "Internal server error." },
};
beforeEach(() => {
  mocks.forms.clear();
  vi.clearAllMocks();
});

async function respond(action: string, result = failure) {
  const handler = await mocks.forms.get(action)!({} as never);
  if (!handler) throw new Error("Expected an enhanced form callback");
  const update = vi.fn();
  await handler({ result, update } as never);
  await tick();
  return update;
}

it.each(["create", "edit"] as const)(
  "keeps the %s dialog open and shows failure without discarding input",
  async (mode) => {
    const target = document.body.appendChild(document.createElement("div"));
    const onclose = vi.fn();
    const component = mount(CourseAnnouncementDialog, {
      target,
      props: { open: true, mode, initial: announcement, onclose },
    });
    try {
      await tick();
      const update = await respond(
        mode === "create" ? "?/createAnnouncement" : "?/updateAnnouncement",
      );
      expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain(
        "Internal server error.",
      );
      expect(document.querySelector<HTMLInputElement>('[name="title"]')?.value).toBe(
        announcement.title,
      );
      expect(onclose).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      const boundary = await respond(
        mode === "create" ? "?/createAnnouncement" : "?/updateAnnouncement",
        { type: "error", status: 500, error: { message: "Server error" } },
      );
      expect(boundary).toHaveBeenCalledOnce();
    } finally {
      await unmount(component);
      target.remove();
    }
  },
);

it.each(["togglePinAnnouncement", "deleteAnnouncement"])(
  "shows %s failure and preserves the delete confirmation for retry",
  async (action) => {
    const target = document.body.appendChild(document.createElement("div"));
    const component = mount(CoursePage, {
      target,
      props: {
        data: {
          course: { id: "c1" },
          isManager: true,
          announcements: [announcement],
          assignments: [],
          exams: [],
        } as never,
      },
    });
    try {
      await tick();
      if (action === "deleteAnnouncement") {
        target
          .querySelector<HTMLButtonElement>(`button[aria-label="${m.common_delete()}"]`)!
          .click();
        await tick();
      }
      const update = await respond(`?/${action}`);
      expect(mocks.toastError).toHaveBeenCalledWith("Internal server error.");
      expect(update).not.toHaveBeenCalled();
      if (action === "deleteAnnouncement") {
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        expect(
          target.querySelector<HTMLInputElement>('form[action="?/deleteAnnouncement"] input')
            ?.value,
        ).toBe(announcement.id);
      }
      const boundary = await respond(`?/${action}`, {
        type: "error",
        status: 500,
        error: { message: "Server error" },
      });
      expect(boundary).toHaveBeenCalledOnce();
    } finally {
      await unmount(component);
      target.remove();
    }
  },
);
