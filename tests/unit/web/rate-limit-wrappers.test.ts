import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiConsume, writeConsume, registryConsume, formConsume } = vi.hoisted(() => ({
  apiConsume: vi.fn(),
  writeConsume: vi.fn(),
  registryConsume: vi.fn(),
  formConsume: vi.fn(),
}));

vi.mock("$lib/server/shared/rate-limiter", () => ({
  apiRateLimiter: { consume: apiConsume },
  writeApiRateLimiter: { consume: writeConsume },
  registryTokenRateLimiter: { consume: registryConsume },
  consumeFormRateLimitInternal: formConsume,
}));

import {
  apiHandler,
  registryTokenApiHandler,
  writeApiHandler,
} from "$lib/server/shared/api-handler";
import { withRateLimit, withRateLimitActions } from "$lib/server/shared/action-handlers";

function makeEvent(): RequestEvent {
  return {
    locals: { sessionUser: null, apiTokenActor: null },
    request: new Request("http://localhost/api/test"),
    url: new URL("http://localhost/api/test"),
    getClientAddress: () => "127.0.0.1",
  } as unknown as RequestEvent;
}

beforeEach(() => {
  apiConsume.mockReset().mockResolvedValue("allowed");
  writeConsume.mockReset().mockResolvedValue("allowed");
  registryConsume.mockReset().mockResolvedValue("allowed");
  formConsume.mockReset().mockResolvedValue(null);
});

describe("API rate-limit wrappers", () => {
  it("keeps quota exhaustion as 429", async () => {
    writeConsume.mockResolvedValue("limited");
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const response = await writeApiHandler(handler)(makeEvent());
    expect(response.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 503 for a strict limiter outage", async () => {
    writeConsume.mockResolvedValue("unavailable");
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const response = await writeApiHandler(handler)(makeEvent());
    expect(response.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not disguise an unknown limiter error", async () => {
    const limiterError = new Error("limiter bug");
    apiConsume.mockRejectedValue(limiterError);
    await expect(apiHandler(vi.fn())(makeEvent())).rejects.toBe(limiterError);
  });

  it("uses the dedicated strict registry-token limiter", async () => {
    registryConsume.mockResolvedValue("unavailable");
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const response = await registryTokenApiHandler(handler)(makeEvent());
    expect(response.status).toBe(503);
    expect(registryConsume).toHaveBeenCalledOnce();
    expect(apiConsume).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not disguise an unknown registry limiter error", async () => {
    const limiterError = new Error("limiter bug");
    registryConsume.mockRejectedValue(limiterError);
    await expect(registryTokenApiHandler(vi.fn())(makeEvent())).rejects.toBe(limiterError);
  });
});

describe("form rate-limit wrapper", () => {
  it("returns the limiter's 503 failure without invoking the action", async () => {
    formConsume.mockResolvedValue({
      status: 503,
      data: { error: "Rate limiter unavailable." },
    });
    const action = vi.fn().mockResolvedValue({ ok: true });
    const result = await withRateLimit(action)(makeEvent());
    expect(result).toMatchObject({ status: 503 });
    expect(action).not.toHaveBeenCalled();
  });

  it("does not disguise an unknown form-limiter error", async () => {
    const limiterError = new Error("limiter bug");
    formConsume.mockRejectedValue(limiterError);
    await expect(withRateLimit(vi.fn())(makeEvent())).rejects.toBe(limiterError);
  });

  it("strictly gates every two-factor action in a mapped action group", async () => {
    formConsume.mockResolvedValue({
      status: 503,
      data: { error: "Rate limiter unavailable." },
    });
    const actionNames = [
      "sendEmailOtp",
      "activate",
      "deactivate",
      "enable",
      "verify",
      "disable",
      "regenerate",
      "deletePasskey",
    ] as const;
    const rawActions = Object.fromEntries(actionNames.map((name) => [name, vi.fn()]));
    const actions = withRateLimitActions(rawActions);

    for (const name of actionNames) {
      await expect(actions[name](makeEvent())).resolves.toMatchObject({ status: 503 });
      expect(rawActions[name]).not.toHaveBeenCalled();
    }
    expect(formConsume).toHaveBeenCalledTimes(actionNames.length);
  });
});
