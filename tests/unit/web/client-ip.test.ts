import { describe, expect, it, vi } from "vitest";

const { getWebEnvMock } = vi.hoisted(() => ({
  getWebEnvMock: vi.fn(),
}));

vi.mock("$lib/server/env", () => ({
  getWebEnv: getWebEnvMock,
}));

const { getClientIp } = await import("$lib/server/shared/client-ip");

function mockEvent(opts: {
  cfIp?: string | null;
  devIp?: string | null;
  socket?: string;
}): Parameters<typeof getClientIp>[0] {
  const headers = new Headers();
  if (opts.cfIp) headers.set("cf-connecting-ip", opts.cfIp);
  if (opts.devIp) headers.set("x-dev-ip", opts.devIp);
  return {
    request: new Request("https://nojv.test", { headers }),
    getClientAddress: () => opts.socket ?? "127.0.0.1",
  } as unknown as Parameters<typeof getClientIp>[0];
}

describe("getClientIp — production", () => {
  it("returns the CF-Connecting-IP value", () => {
    getWebEnvMock.mockReturnValue({ NODE_ENV: "production" });
    const ip = getClientIp(mockEvent({ cfIp: "203.0.113.42" }));
    expect(ip).toBe("203.0.113.42");
  });

  it("trims surrounding whitespace from CF-Connecting-IP", () => {
    getWebEnvMock.mockReturnValue({ NODE_ENV: "production" });
    const ip = getClientIp(mockEvent({ cfIp: "  203.0.113.42  " }));
    expect(ip).toBe("203.0.113.42");
  });

  it("throws 403 when CF-Connecting-IP is missing (no fallback)", () => {
    getWebEnvMock.mockReturnValue({ NODE_ENV: "production" });
    expect(() => getClientIp(mockEvent({ socket: "10.0.0.1" }))).toThrow();
  });

  it("ignores x-dev-ip in production (no header injection)", () => {
    getWebEnvMock.mockReturnValue({ NODE_ENV: "production" });
    expect(() => getClientIp(mockEvent({ devIp: "1.2.3.4", socket: "10.0.0.1" }))).toThrow();
  });

  it("ignores socket address in production (no fallback)", () => {
    getWebEnvMock.mockReturnValue({ NODE_ENV: "production" });
    expect(() => getClientIp(mockEvent({ socket: "10.0.0.1" }))).toThrow();
  });
});

describe("getClientIp — development", () => {
  it("prefers x-dev-ip header when present", () => {
    getWebEnvMock.mockReturnValue({ NODE_ENV: "development" });
    const ip = getClientIp(mockEvent({ devIp: "10.1.2.3", socket: "127.0.0.1" }));
    expect(ip).toBe("10.1.2.3");
  });

  it("trims x-dev-ip", () => {
    getWebEnvMock.mockReturnValue({ NODE_ENV: "development" });
    const ip = getClientIp(mockEvent({ devIp: "  10.1.2.3  " }));
    expect(ip).toBe("10.1.2.3");
  });

  it("falls back to socket address when x-dev-ip absent", () => {
    getWebEnvMock.mockReturnValue({ NODE_ENV: "development" });
    const ip = getClientIp(mockEvent({ socket: "192.168.1.50" }));
    expect(ip).toBe("192.168.1.50");
  });

  it("does NOT require CF-Connecting-IP in dev", () => {
    getWebEnvMock.mockReturnValue({ NODE_ENV: "development" });
    expect(() => getClientIp(mockEvent({ socket: "127.0.0.1" }))).not.toThrow();
  });
});
