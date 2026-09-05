// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { expect, it, vi } from "vitest";
import { m } from "$lib/paraglide/messages.js";

vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock("@lucide/svelte", async () => {
  const Empty = (await import("./fixtures/empty-component.svelte")).default;
  return { Plus: Empty, Trophy: Empty };
});

import ContestsPage from "../../../apps/web/src/routes/(app)/contests/+page.svelte";

it.each([{ error: "Internal server error." }, { codeError: "Invalid invitation code." }])(
  "shows the join failure in the dialog: %o",
  async (form) => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(ContestsPage, {
      target,
      props: {
        data: { managed: [], participable: [], loggedIn: true, canCreate: false },
        form,
      },
    });
    try {
      await tick();
      [...target.querySelectorAll("button")]
        .find((button) => button.textContent?.includes(m.contestsList_joinByCode()))!
        .click();
      await tick();
      expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain(
        form.error ?? form.codeError,
      );
    } finally {
      await unmount(component);
      target.remove();
    }
  },
);
