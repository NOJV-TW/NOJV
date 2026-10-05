import { mount, tick, unmount } from "svelte";
import { expect, it, vi } from "vitest";
import TableSelectColumnFilter from "$lib/components/primitives/ui/TableSelectColumnFilter.svelte";
import TableTextColumnFilter from "$lib/components/primitives/ui/TableTextColumnFilter.svelte";
import { m } from "$lib/paraglide/messages.js";

function clearButton(target: HTMLElement, label: string) {
  return target.querySelector<HTMLButtonElement>(
    `button[aria-label="${m.common_clearFilter({ label })}"]`,
  );
}

it("clears an active text filter and re-applies it", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const onApply = vi.fn();
  const component = mount(TableTextColumnFilter, {
    target,
    props: {
      label: "Email",
      filterLabel: "Filter email",
      inputId: "email-filter",
      applyLabel: "Apply",
      value: "alice",
      onApply,
    },
  });
  await tick();

  expect(target.textContent).toContain("alice");
  clearButton(target, "Email")?.click();
  await tick();

  expect(onApply).toHaveBeenCalledOnce();
  expect(target.textContent).not.toContain("alice");
  expect(clearButton(target, "Email")).toBeNull();
  expect(document.activeElement).toBe(target.querySelector('[aria-label="Filter email"]'));

  await unmount(component);
  target.remove();
});

it("hides the text filter clear button while the filter is empty", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(TableTextColumnFilter, {
    target,
    props: {
      label: "Email",
      filterLabel: "Filter email",
      inputId: "email-filter",
      applyLabel: "Apply",
      value: "",
    },
  });

  expect(clearButton(target, "Email")).toBeNull();

  await unmount(component);
  target.remove();
});

it("clears an active select filter", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const onChange = vi.fn();
  const component = mount(TableSelectColumnFilter, {
    target,
    props: {
      label: "Role",
      filterLabel: "Filter role",
      value: "ta",
      options: [
        { value: "student", label: "Student" },
        { value: "ta", label: "TA" },
      ],
      onChange,
    },
  });
  await tick();

  const trigger = target.querySelector('[aria-label="Filter role"]');
  expect(trigger?.textContent).toContain("TA");
  clearButton(target, "Role")?.click();
  await tick();

  expect(onChange).toHaveBeenCalledExactlyOnceWith("");
  expect(trigger?.textContent).toContain("Role");
  expect(clearButton(target, "Role")).toBeNull();
  expect(document.activeElement).toBe(trigger);

  await unmount(component);
  target.remove();
});
