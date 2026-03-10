import { beforeEach, describe, expect, it, vi } from "vitest";

interface BetterAuthConfig {
  databaseHooks?: unknown;
  plugins?: unknown[];
  user?: {
    additionalFields?: {
      handle?: {
        required?: boolean;
      };
    };
  };
}

const betterAuth = vi.fn((config: BetterAuthConfig) => ({ config }));
const prismaAdapter = vi.fn(() => ({ adapter: "prisma" }));
const nextCookiesPlugin = { id: "next-cookies" };
const nextCookies = vi.fn(() => nextCookiesPlugin);
const usernamePlugin = { id: "username" };
const username = vi.fn(() => usernamePlugin);

vi.mock("better-auth", () => ({ betterAuth }));
vi.mock("better-auth/adapters/prisma", () => ({ prismaAdapter }));
vi.mock("better-auth/next-js", () => ({ nextCookies }));
vi.mock("better-auth/plugins", () => ({ username }));
vi.mock("@nojv/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn()
    }
  }
}));

describe("auth config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("registers Better Auth's Next.js cookie plugin as the last plugin and leaves handle completion explicit", async () => {
    await import("../src/lib/auth");

    expect(betterAuth).toHaveBeenCalledOnce();
    expect(nextCookies).toHaveBeenCalledOnce();
    expect(username).toHaveBeenCalledOnce();

    const [config] = betterAuth.mock.calls[0] ?? [];
    expect(config).toBeDefined();
    expect(config?.plugins).toBeDefined();
    expect(config?.plugins).toContain(usernamePlugin);
    expect(config?.plugins).toContain(nextCookiesPlugin);
    expect(config?.plugins?.at(-1)).toBe(nextCookiesPlugin);
    expect(config?.user?.additionalFields?.handle).toBeUndefined();
    expect(config?.databaseHooks).toBeUndefined();
    expect(username).toHaveBeenCalledWith(
      expect.objectContaining({
        maxUsernameLength: 64,
        schema: {
          user: {
            fields: {
              displayUsername: "displayHandle",
              username: "handle"
            }
          }
        }
      })
    );
  });
});
