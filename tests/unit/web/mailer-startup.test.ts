import { beforeEach, describe, expect, it, vi } from "vitest";

const { validateMailerConfig } = vi.hoisted(() => ({ validateMailerConfig: vi.fn() }));

vi.mock("@nojv/mailer", () => ({ validateMailerConfig }));

beforeEach(() => {
  vi.resetModules();
  validateMailerConfig.mockReset();
});

describe("web mailer startup validation", () => {
  it("validates mailer configuration at runtime startup", async () => {
    vi.doMock("$app/environment", () => ({ building: false }));
    await import("../../../apps/web/src/lib/server/mailer-startup");
    expect(validateMailerConfig).toHaveBeenCalledOnce();
  });

  it("does not require runtime mailer secrets during the SvelteKit build", async () => {
    vi.doMock("$app/environment", () => ({ building: true }));
    await import("../../../apps/web/src/lib/server/mailer-startup");
    expect(validateMailerConfig).not.toHaveBeenCalled();
  });
});
