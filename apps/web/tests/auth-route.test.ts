import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = { handler: vi.fn() };
const GET = vi.fn();
const POST = vi.fn();
const toNextJsHandler = vi.fn(() => ({
  GET,
  POST
}));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("better-auth/next-js", () => ({ toNextJsHandler }));

describe("auth catch-all route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("delegates GET and POST to Better Auth's Next.js handler", async () => {
    const route = await import("../src/app/api/auth/[...all]/route");

    expect(toNextJsHandler).toHaveBeenCalledOnce();
    expect(toNextJsHandler).toHaveBeenCalledWith(auth);
    expect(route.GET).toBe(GET);
    expect(route.POST).toBe(POST);
    expect("PATCH" in route).toBe(false);
    expect("PUT" in route).toBe(false);
    expect("DELETE" in route).toBe(false);
  });
});
