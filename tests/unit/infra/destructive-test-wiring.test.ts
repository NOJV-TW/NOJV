import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

const repoRoot = process.cwd();
const integrationUrl = "postgresql://postgres:postgres@127.0.0.1:5432/nojv_test";
const e2eUrl = "postgresql://postgres:postgres@127.0.0.1:5432/nojv_e2e_test";

describe("destructive database provisioning and CI wiring", () => {
  it("offers an explicit local provisioning command for both durable markers", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const provisioning = readFileSync(
      join(repoRoot, "tests/setup/provision-test-databases.ts"),
      "utf8",
    );

    expect(packageJson.scripts["test:db:provision"]).toContain("provision-test-databases.ts");
    expect(provisioning).toContain("NOJV_TEST_DATABASE:nojv_test");
    expect(provisioning).toContain("NOJV_TEST_DATABASE:nojv_e2e_test");
    expect(provisioning).toContain("COMMENT ON DATABASE");
  });

  it.each([".github/workflows/ci.yml", ".github/workflows/nightly-sandbox.yml"])(
    "%s explicitly supplies the guarded URL, marker, and durable COMMENT",
    (relativePath) => {
      const workflow = readFileSync(join(repoRoot, relativePath), "utf8");
      expect(workflow).toContain(`TEST_DATABASE_URL: ${integrationUrl}`);
      expect(workflow).toContain("NOJV_DESTRUCTIVE_TEST_DATABASE: nojv_test");
      expect(workflow).toContain(
        "COMMENT ON DATABASE nojv_test IS 'NOJV_TEST_DATABASE:nojv_test'",
      );
    },
  );
});

describe("Playwright destructive database isolation", () => {
  it("uses only nojv_e2e_test on strict port 5174 and never reuses a server", async () => {
    vi.stubEnv("TEST_DATABASE_URL", e2eUrl);
    vi.stubEnv("NOJV_DESTRUCTIVE_TEST_DATABASE", "nojv_e2e_test");
    vi.resetModules();

    const config = (await import("../../e2e/playwright.config.ts")).default;

    expect(config.use?.baseURL).toBe("http://localhost:5174");
    expect(existsSync(join(repoRoot, "apps/web/static/favicon.svg"))).toBe(true);
    expect(config.webServer).toMatchObject({
      reuseExistingServer: false,
      url: "http://localhost:5174/favicon.svg",
    });
    const server = config.webServer as { command: string; env: Record<string, string> };
    expect(server.command).toContain("--port 5174");
    expect(server.command).toContain("--strictPort");
    expect(server.env.DATABASE_URL).toBe(e2eUrl);
    expect(server.env).toMatchObject({
      S3_ACCESS_KEY: "minioadmin",
      S3_BUCKET: "nojv",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_REGION: "us-east-1",
      S3_SECRET_KEY: "minioadmin",
    });
  });

  it("keeps one localhost browser origin and centralizes live session reads", () => {
    const e2eDir = join(repoRoot, "tests/e2e");
    const sources = [
      ...readdirSync(e2eDir)
        .filter((file) => file.endsWith(".ts"))
        .map((file) => [file, readFileSync(join(e2eDir, file), "utf8")] as const),
      [
        "../setup/playwright-global-setup.ts",
        readFileSync(join(repoRoot, "tests/setup/playwright-global-setup.ts"), "utf8"),
      ] as const,
    ];

    const loopbackOrigins = sources.flatMap(([file, source]) =>
      [...source.matchAll(/http:\/\/(?:127\.0\.0\.1|localhost):5174/g)].map((match) => ({
        file,
        value: match[0],
      })),
    );
    expect(loopbackOrigins).toEqual([{ file: "_shared.ts", value: "http://localhost:5174" }]);

    const directSessionReads = sources
      .filter(
        ([file, source]) => file !== "_shared.ts" && source.includes("/api/auth/get-session"),
      )
      .map(([file]) => file);
    expect(directSessionReads).toEqual([]);
  });

  it("does not create the general @nojv/db singleton at Playwright setup module evaluation", () => {
    const setup = readFileSync(
      join(repoRoot, "tests/setup/playwright-global-setup.ts"),
      "utf8",
    );
    expect(setup).not.toMatch(/^import .* from "@nojv\/db";/m);
    expect(setup).not.toMatch(/^import .* from "@nojv\/application";/m);
    expect(setup).toContain('resolveDestructiveTestDatabase("nojv_e2e_test")');
    expect(setup).toContain('"db", "push", "--accept-data-loss"');
    expect(setup).toContain("await truncateAllTables()");
    expect(setup).toContain('"packages/db/prisma/seed.ts"');
    expect(setup).toContain('SEED_ADMIN_USERNAME: "admin"');
    expect(setup).toContain('SEED_ADMIN_EMAIL: "admin@nojv.local"');
    expect(setup).toContain('SEED_ADMIN_PASSWORD: "password123"');
  });

  it("routes disposable-user SQL through the validated E2E database", () => {
    const disposableUser = readFileSync(
      join(repoRoot, "tests/e2e/_disposable-user.ts"),
      "utf8",
    );
    const apiTokenStepUp = readFileSync(
      join(repoRoot, "tests/e2e/api-token-step-up.test.ts"),
      "utf8",
    );

    expect(disposableUser).toContain('resolveDestructiveTestDatabase("nojv_e2e_test")');
    expect(disposableUser).toMatch(/"compose",\s*"exec",\s*"-T",\s*"postgres"/s);
    expect(disposableUser).not.toMatch(/"-d",\s*"nojv"/s);
    expect(apiTokenStepUp).toContain("import { psql, signInWithPassword }");
    expect(apiTokenStepUp).not.toContain("function pg(");
  });
});
