import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockUser {
  disabled: boolean;
  email: string;
  emailVerified: boolean;
  id: string;
  name: string;
  platformRole: "admin" | "teacher" | "student";
  status: "active" | "disabled" | "pending_first_login";
  username: string | null;
}

const { state } = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  const users = new Map<string, MockUser>();
  let seq = 0;
  return {
    state: {
      rows,
      users,
      nextId: () => `tok_${(seq += 1)}`,
      reset() {
        rows.clear();
        users.clear();
        seq = 0;
      },
    },
  };
});

function ownerOf(userId: string): MockUser {
  return (
    state.users.get(userId) ?? {
      disabled: false,
      email: "owner@example.com",
      emailVerified: true,
      id: userId,
      name: "Owner",
      platformRole: "student",
      status: "active",
      username: "owner",
    }
  );
}

vi.mock("@nojv/db", () => ({
  apiTokenRepo: {
    create(data: Record<string, unknown>) {
      const id = state.nextId();
      const now = new Date();
      const row = {
        createdAt: now,
        expiresAt: data.expiresAt,
        id,
        lastUsedAt: null,
        lastUsedIp: null,
        name: data.name,
        prefix: data.prefix,
        revokedAt: null,
        revokedById: null,
        scopes: (data.scopes as string[]) ?? [],
        status: "active",
        tokenHash: data.tokenHash,
        updatedAt: now,
        userId: data.userId,
      };
      state.rows.set(id, row);
      return Promise.resolve(row);
    },
    findByIdForUser(id: string, userId: string) {
      const row = state.rows.get(id);
      return Promise.resolve(row && row.userId === userId ? row : null);
    },
    findByPrefix(prefix: string) {
      for (const row of state.rows.values()) {
        if (row.prefix === prefix) {
          return Promise.resolve({ ...row, user: ownerOf(row.userId as string) });
        }
      }
      return Promise.resolve(null);
    },
    listForUser(userId: string) {
      return Promise.resolve([...state.rows.values()].filter((row) => row.userId === userId));
    },
    updateForUser(id: string, userId: string, data: Record<string, unknown>) {
      const row = state.rows.get(id);
      const matched = Boolean(row && row.userId === userId);
      if (row && matched) Object.assign(row, data);
      return Promise.resolve({ count: matched ? 1 : 0 });
    },
    markUsed(id: string, ip: string) {
      const row = state.rows.get(id);
      if (row) {
        row.lastUsedAt = new Date();
        row.lastUsedIp = ip;
      }
      return Promise.resolve(row);
    },
  },
}));

import {
  createApiToken,
  findApiTokenRouteRule,
  revokeApiToken,
  rotateApiToken,
  verifyApiTokenForRoute,
} from "@nojv/application";

const submitRoute = findApiTokenRouteRule("POST", "/api/submissions")!;
const adminRoute = findApiTokenRouteRule("GET", "/api/admin/healthz")!;

function setUser(userId: string, overrides: Partial<MockUser> = {}): void {
  state.users.set(userId, { ...ownerOf(userId), id: userId, ...overrides });
}

function create(opts: {
  scopes: string[];
  platformRole?: MockUser["platformRole"];
  userId?: string;
}) {
  return createApiToken({
    expiresInDays: 30,
    name: "CI token",
    platformRole: opts.platformRole ?? "student",
    scopes: opts.scopes,
    userId: opts.userId ?? "usr_1",
  });
}

function verify(token: string, route = submitRoute, ip = "203.0.113.7") {
  return verifyApiTokenForRoute({ ip, route, token });
}

async function catchError(
  promise: Promise<unknown>,
): Promise<{ status?: number; message: string }> {
  let rejected = false;
  let settled: unknown;
  await promise.then(
    (value) => {
      settled = value;
    },
    (err) => {
      rejected = true;
      settled = err;
    },
  );
  if (!rejected) throw new Error("Expected the promise to reject, but it resolved.");
  const err = settled as { status?: unknown; message?: unknown };
  return {
    message: typeof err?.message === "string" ? err.message : String(settled),
    ...(typeof err?.status === "number" ? { status: err.status } : {}),
  };
}

beforeEach(() => {
  state.reset();
});

describe("API token lifecycle and verification", () => {
  it("creates a token, persists only a hash, and verifies the plaintext round-trip", async () => {
    setUser("usr_1", { platformRole: "student" });
    const created = await create({ scopes: ["submissions:write"] });

    expect(created.token).toMatch(/^nojv_live_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const stored = [...state.rows.values()][0]!;
    expect(stored.tokenHash).not.toBe(created.token);
    expect(created.token).not.toContain(stored.tokenHash as string);
    expect(Object.keys(created.item)).not.toContain("tokenHash");
    expect(JSON.stringify(created.item)).not.toContain(created.token);

    const verified = await verify(created.token);
    expect(verified.actor.userId).toBe("usr_1");
    expect(verified.scopes).toContain("submissions:write");
  });

  it("rejects a malformed token", async () => {
    const err = await catchError(verify("not-a-token"));
    expect(err.status).toBe(401);
  });

  it("rejects a well-formed token with an unknown prefix", async () => {
    const err = await catchError(verify(`nojv_live_${"a".repeat(11)}.${"b".repeat(43)}`));
    expect(err.status).toBe(401);
  });

  it("rejects a tampered secret reusing a valid prefix (hash mismatch)", async () => {
    setUser("usr_1");
    const created = await create({ scopes: ["submissions:write"] });
    const prefix = created.token.slice("nojv_live_".length).split(".")[0];
    const forged = `nojv_live_${prefix}.${"A".repeat(43)}`;

    expect(forged).not.toBe(created.token);
    const err = await catchError(verify(forged));
    expect(err.status).toBe(401);
  });

  it("invalidates the previous secret after rotation", async () => {
    setUser("usr_1");
    const created = await create({ scopes: ["submissions:write"] });
    const rotated = await rotateApiToken({ id: created.item.id, userId: "usr_1" });

    expect(rotated.token).not.toBe(created.token);

    const oldErr = await catchError(verify(created.token));
    expect(oldErr.status).toBe(401);

    const verified = await verify(rotated.token);
    expect(verified.actor.userId).toBe("usr_1");
  });

  it("refuses to rotate a revoked token", async () => {
    setUser("usr_1");
    const created = await create({ scopes: ["submissions:write"] });
    await revokeApiToken({ id: created.item.id, revokedById: "usr_1", userId: "usr_1" });

    const err = await catchError(rotateApiToken({ id: created.item.id, userId: "usr_1" }));
    expect(err.status).toBe(403);
  });

  it("rejects a revoked token immediately", async () => {
    setUser("usr_1");
    const created = await create({ scopes: ["submissions:write"] });
    await revokeApiToken({ id: created.item.id, revokedById: "usr_1", userId: "usr_1" });

    const err = await catchError(verify(created.token));
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/revoked/i);
  });

  it("rejects an expired token", async () => {
    setUser("usr_1");
    const created = await create({ scopes: ["submissions:write"] });
    const row = [...state.rows.values()][0]!;
    row.expiresAt = new Date(Date.now() - 1000);

    const err = await catchError(verify(created.token));
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/expired/i);
  });

  it("rejects a token whose owner is disabled", async () => {
    setUser("usr_1", { disabled: true });
    const created = await create({ scopes: ["submissions:write"] });

    const err = await catchError(verify(created.token));
    expect(err.status).toBe(401);
  });

  it("enforces the required route scope at verification time", async () => {
    setUser("usr_1");
    const created = await create({ scopes: ["submissions:read"] });

    const err = await catchError(verify(created.token, submitRoute));
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/scope/i);
  });

  it("re-checks the owner's live platform role for role-gated routes", async () => {
    setUser("usr_admin", { platformRole: "admin" });
    const created = await create({
      platformRole: "admin",
      scopes: ["admin:read"],
      userId: "usr_admin",
    });

    const ok = await verify(created.token, adminRoute);
    expect(ok.actor.platformRole).toBe("admin");

    setUser("usr_admin", { platformRole: "teacher" });
    const err = await catchError(verify(created.token, adminRoute));
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/role/i);
  });

  it("fails closed when the pepper is missing in production", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevPepper = process.env.API_TOKEN_PEPPER;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.API_TOKEN_PEPPER;
      setUser("usr_1");

      const err = await catchError(create({ scopes: ["submissions:write"] }));
      expect(err.status).toBe(500);
      expect(err.message).toMatch(/API_TOKEN_PEPPER/);
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevPepper === undefined) delete process.env.API_TOKEN_PEPPER;
      else process.env.API_TOKEN_PEPPER = prevPepper;
    }
  });
});
