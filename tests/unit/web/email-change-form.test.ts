// @vitest-environment jsdom

import { mount, tick, unmount } from "svelte";
import { expect, it, vi } from "vitest";

vi.mock("$app/forms", () => ({
  enhance: () => ({ destroy() {} }),
}));
vi.mock("$app/navigation", () => ({ goto: vi.fn() }));
vi.mock("$lib/stores/toast", () => ({ toasts: { success: vi.fn() } }));
vi.mock("sveltekit-superforms", async () => {
  const { writable } = await import("svelte/store");
  return {
    superForm: () => ({
      form: writable({ newEmail: "" }),
      errors: writable({}),
      enhance: () => ({ destroy() {} }),
      message: writable(null),
      submitting: writable(false),
    }),
  };
});
vi.mock("$lib/components/primitives/ui/FormField.svelte", async () => ({
  default: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/primitives/ui/input", async () => ({
  Input: (await import("./fixtures/empty-component.svelte")).default,
}));
vi.mock("$lib/components/primitives/ui/button", async () => ({
  Button: (await import("./fixtures/component-button.svelte")).default,
}));

import EmailChangeForm from "$lib/components/features/account/EmailChangeForm.svelte";

it("lets an unverified address restart the change-email form after a callback error", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(EmailChangeForm, {
    target,
    props: {
      currentEmail: "new@example.com",
      data: { valid: true, data: { newEmail: "" }, errors: [], id: "email" },
      emailVerified: false,
      verificationError: "tokenExpired",
    },
  });

  expect(target.textContent).toContain("email verification link expired");
  expect(target.querySelector('form[action="?/resendEmailVerification"]')).toBeNull();

  target.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await tick();

  expect(target.querySelector('form[action="?/changeEmail"]')).not.toBeNull();

  await unmount(component);
  target.remove();
});
