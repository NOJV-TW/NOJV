import { beforeEach, describe, expect, it, vi } from "vitest";

const { envState } = vi.hoisted(() => ({
  envState: { value: {} as Record<string, unknown> },
}));

vi.mock("$lib/server/env", () => ({
  getWebEnv: () => envState.value,
}));

import { getMailer } from "$lib/server/mailer";

beforeEach(() => {
  envState.value = {
    GMAIL_USER: "nojv.tw@gmail.com",
    GMAIL_APP_PASSWORD: "app-password",
  };
});

describe("mailer seam", () => {
  it("resolves the gmail provider to a mailer", () => {
    const mailer = getMailer();
    expect(typeof mailer.sendEmail).toBe("function");
  });

  it("throws when GMAIL_USER is missing", () => {
    envState.value = { GMAIL_APP_PASSWORD: "app-password" };
    expect(() => getMailer()).toThrow(/GMAIL_USER/);
  });

  it("throws when GMAIL_APP_PASSWORD is missing", () => {
    envState.value = { GMAIL_USER: "nojv.tw@gmail.com" };
    expect(() => getMailer()).toThrow(/GMAIL_APP_PASSWORD/);
  });
});
