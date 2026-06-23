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
    EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_test",
    EMAIL_FROM_DOMAIN: "nojv.test",
  };
});

describe("mailer seam", () => {
  it("resolves the resend provider to a mailer", () => {
    const mailer = getMailer();
    expect(typeof mailer.sendEmail).toBe("function");
  });

  it("throws when RESEND_API_KEY is missing", () => {
    envState.value = { EMAIL_PROVIDER: "resend", EMAIL_FROM_DOMAIN: "nojv.test" };
    expect(() => getMailer()).toThrow(/RESEND_API_KEY/);
  });

  it("throws when EMAIL_FROM_DOMAIN is missing", () => {
    envState.value = { EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test" };
    expect(() => getMailer()).toThrow(/EMAIL_FROM_DOMAIN/);
  });
});
