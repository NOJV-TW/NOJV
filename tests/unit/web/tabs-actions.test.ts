// @vitest-environment jsdom

import { mount, unmount } from "svelte";
import { describe, expect, it } from "vitest";

import TabsWithActions from "./fixtures/tabs-with-actions.svelte";

describe("Tabs actions", () => {
  it("places contextual controls alongside the tab titles", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(TabsWithActions, { target });

    const search = target.querySelector('[aria-label="搜尋學號或 IP"]');
    expect(search).not.toBeNull();
    expect(
      search?.parentElement?.parentElement?.querySelector('[role="tablist"]'),
    ).not.toBeNull();

    await unmount(component);
    target.remove();
  });
});
