import { describe, expect, it } from "vitest";

import { resolveClientIp } from "../../../apps/web/src/lib/server/shared/client-ip";

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("Expected function to throw");
}

function expectHttpError(err: unknown, status: number, message: string): void {
  expect(err).toMatchObject({ status, body: { message } });
}

describe("resolveClientIp", () => {
  it("uses x-dev-ip outside production when it is a valid IP address", () => {
    const headers = new Headers({ "x-dev-ip": "203.0.113.10" });

    expect(resolveClientIp(headers, () => "127.0.0.1", { NODE_ENV: "test" })).toBe(
      "203.0.113.10",
    );
  });

  it("ignores invalid x-dev-ip outside production", () => {
    const headers = new Headers({ "x-dev-ip": "not-an-ip" });

    expect(resolveClientIp(headers, () => "127.0.0.1", { NODE_ENV: "test" })).toBe("127.0.0.1");
  });

  it("trusts cf-connecting-ip in production (Cloudflare is the only path to origin)", () => {
    const headers = new Headers({ "cf-connecting-ip": "2001:db8::1" });

    expect(resolveClientIp(headers, () => "10.0.0.1", { NODE_ENV: "production" })).toBe(
      "2001:db8::1",
    );
  });

  it("rejects production requests with a missing or invalid Cloudflare IP header", () => {
    const err = captureError(() =>
      resolveClientIp(new Headers({ "cf-connecting-ip": "not-an-ip" }), () => "10.0.0.1", {
        NODE_ENV: "production",
      }),
    );

    expectHttpError(err, 403, "Trusted edge did not provide a valid client IP.");
  });
});
