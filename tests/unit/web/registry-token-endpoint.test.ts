import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const CERT_BODY = Buffer.from("fake-der-certificate-bytes").toString("base64");
const CERT_PEM = `-----BEGIN CERTIFICATE-----\n${CERT_BODY}\n-----END CERTIFICATE-----\n`;

process.env.REGISTRY_PUBLIC_HOST = "registry.test.local";
process.env.REGISTRY_TOKEN_ISSUER = "nojv-test";
process.env.REGISTRY_TOKEN_PRIVATE_KEY = Buffer.from(PRIVATE_PEM).toString("base64");
process.env.REGISTRY_TOKEN_CERT = Buffer.from(CERT_PEM).toString("base64");
process.env.REGISTRY_PULL_PASSWORD_HASH = "";

const { verifyRegistryLogin } = vi.hoisted(() => ({ verifyRegistryLogin: vi.fn() }));

vi.mock("@nojv/application", async (importOriginal) => {
  const original = await importOriginal<typeof import("@nojv/application")>();
  return {
    ...original,
    registryDomain: {
      ...original.registryDomain,
      verifyRegistryLogin,
    },
  };
});

const { signRegistryToken, isRegistryTokenConfigured } =
  await import("$lib/server/registry-token");
const { GET, POST } = await import("../../../apps/web/src/routes/api/registry/token/+server");
const { decodeProtectedHeader, jwtVerify } = await import("jose");

function makeEvent(query: string, authorization?: string) {
  const url = new URL(`https://nojv.tw/api/registry/token${query}`);
  return {
    url,
    request: new Request(url, {
      headers: authorization ? { authorization } : {},
    }),
    locals: { requestId: "req-test" },
    getClientAddress: () => "127.0.0.1",
  } as unknown as Parameters<typeof GET>[0];
}

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function makePostEvent(fields: Record<string, string>, authorization?: string) {
  const url = new URL("https://nojv.tw/api/registry/token");
  return {
    url,
    request: new Request(url, {
      method: "POST",
      body: new URLSearchParams(fields),
      headers: authorization ? { authorization } : {},
    }),
    locals: { requestId: "req-test" },
    getClientAddress: () => "127.0.0.1",
  } as unknown as Parameters<typeof POST>[0];
}

describe("signRegistryToken", () => {
  it("is configured from the test env", () => {
    expect(isRegistryTokenConfigured()).toBe(true);
  });

  it("signs a verifiable ES256 JWT with x5c header and access claim", async () => {
    const access = [{ type: "repository", name: "t/alice/run", actions: ["pull", "push"] }];
    const result = await signRegistryToken("alice", "registry.test.local", access);

    expect(result.expires_in).toBe(300);
    expect(result.access_token).toBe(result.token);

    const header = decodeProtectedHeader(result.token);
    expect(header.alg).toBe("ES256");
    expect(header.x5c).toEqual([CERT_BODY]);

    const verified = await jwtVerify(result.token, publicKey, {
      issuer: "nojv-test",
      audience: "registry.test.local",
    });
    expect(verified.payload.sub).toBe("alice");
    expect(verified.payload.access).toEqual(access);
    expect(verified.payload.jti).toBeTruthy();
  });
});

describe("GET /api/registry/token", () => {
  it("rejects an unknown service", async () => {
    await expect(GET(makeEvent("?service=evil.example.com"))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("issues an anonymous token with demo pull access only", async () => {
    const res = await GET(
      makeEvent(
        "?service=registry.test.local&scope=repository:demo/x:pull&scope=repository:t/a/b:pull",
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    const verified = await jwtVerify(body.token, publicKey, {
      audience: "registry.test.local",
    });
    expect(verified.payload.access).toEqual([
      { type: "repository", name: "demo/x", actions: ["pull"] },
    ]);
  });

  it("rejects bad teacher credentials with 401", async () => {
    verifyRegistryLogin.mockResolvedValue(null);
    await expect(
      GET(makeEvent("?service=registry.test.local", basic("alice", "wrong"))),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("issues a namespace-scoped token for a valid teacher login", async () => {
    verifyRegistryLogin.mockResolvedValue({ kind: "teacher", namespace: "alice" });
    const res = await GET(
      makeEvent(
        "?service=registry.test.local&scope=repository:t/alice/run:pull,push&scope=repository:t/bob/run:pull",
        basic("alice", "correct"),
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    const verified = await jwtVerify(body.token, publicKey, {
      audience: "registry.test.local",
    });
    expect(verified.payload.sub).toBe("alice");
    expect(verified.payload.access).toEqual([
      { type: "repository", name: "t/alice/run", actions: ["pull", "push"] },
    ]);
  });

  it("rejects service accounts when their hash is unset", async () => {
    await expect(
      GET(makeEvent("?service=registry.test.local", basic("judge-pull", "whatever"))),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("grants a platform admin's credential push access to the demo namespace", async () => {
    verifyRegistryLogin.mockResolvedValue({ kind: "admin" });
    const res = await GET(
      makeEvent(
        "?service=registry.test.local&scope=repository:demo/nojv-demo-advanced-run:pull,push",
        basic("takala", "correct"),
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    const verified = await jwtVerify(body.token, publicKey, {
      audience: "registry.test.local",
    });
    expect(verified.payload.sub).toBe("admin");
    expect(verified.payload.access).toEqual([
      { type: "repository", name: "demo/nojv-demo-advanced-run", actions: ["pull", "push"] },
    ]);
  });
});

describe("POST /api/registry/token (OAuth2 password grant, containerd/docker login flow)", () => {
  it("rejects an unknown service", async () => {
    await expect(
      POST(makePostEvent({ grant_type: "password", service: "evil.example.com" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("issues a namespace-scoped token from body credentials with space-joined scopes", async () => {
    verifyRegistryLogin.mockResolvedValue({ kind: "teacher", namespace: "alice" });
    const res = await POST(
      makePostEvent({
        grant_type: "password",
        service: "registry.test.local",
        client_id: "containerd-client",
        scope: "repository:t/alice/run:pull,push repository:t/bob/run:pull",
        username: "alice",
        password: "correct",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; access_token: string };
    expect(body.access_token).toBe(body.token);
    const verified = await jwtVerify(body.token, publicKey, {
      audience: "registry.test.local",
    });
    expect(verified.payload.sub).toBe("alice");
    expect(verified.payload.access).toEqual([
      { type: "repository", name: "t/alice/run", actions: ["pull", "push"] },
    ]);
  });

  it("rejects bad body credentials with 401", async () => {
    verifyRegistryLogin.mockResolvedValue(null);
    await expect(
      POST(
        makePostEvent({
          grant_type: "password",
          service: "registry.test.local",
          username: "alice",
          password: "wrong",
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("falls back to Basic auth when the body has no credentials", async () => {
    verifyRegistryLogin.mockResolvedValue({ kind: "teacher", namespace: "alice" });
    const res = await POST(
      makePostEvent(
        {
          grant_type: "password",
          service: "registry.test.local",
          scope: "repository:t/alice/run:pull",
        },
        basic("alice", "correct"),
      ),
    );
    expect(res.status).toBe(200);
  });

  it("issues an anonymous demo-pull token without credentials", async () => {
    const res = await POST(
      makePostEvent({
        grant_type: "password",
        service: "registry.test.local",
        scope: "repository:demo/x:pull repository:t/a/b:pull,push",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    const verified = await jwtVerify(body.token, publicKey, {
      audience: "registry.test.local",
    });
    expect(verified.payload.access).toEqual([
      { type: "repository", name: "demo/x", actions: ["pull"] },
    ]);
  });
});
