import { beforeEach, describe, expect, it, vi } from "vitest";

const { validateMailerConfig } = vi.hoisted(() => ({ validateMailerConfig: vi.fn() }));

vi.mock("@nojv/mailer", () => ({ validateMailerConfig }));

import { validateWorkerMailerStartup } from "../../../apps/worker/src/mailer-startup";

beforeEach(() => {
  validateMailerConfig.mockReset();
});

describe("worker mailer startup validation", () => {
  it.each(["all", "platform"] as const)("validates mailer config in %s mode", (mode) => {
    validateWorkerMailerStartup(mode);
    expect(validateMailerConfig).toHaveBeenCalledOnce();
  });

  it("keeps judge-only workers independent from mailer config", () => {
    validateWorkerMailerStartup("judge");
    expect(validateMailerConfig).not.toHaveBeenCalled();
  });
});
