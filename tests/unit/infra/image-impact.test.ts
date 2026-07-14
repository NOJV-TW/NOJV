import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  changedPathsBetween,
  classifyImageImpact,
} from "../../../scripts/classify-image-impact.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workflowPath = join(repoRoot, ".github/workflows/image-build.yml");
const classifierPath = join(repoRoot, "scripts/classify-image-impact.mjs");

const allImages = ["web", "worker", "migrator", "sandbox"];

function imageNames(paths: string[]): string[] {
  return classifyImageImpact(paths).map(({ image }) => image);
}

function git(repository: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
}

function commit(repository: string, message: string): string {
  git(repository, "add", "--all");
  git(repository, "commit", "--quiet", "-m", message);
  return git(repository, "rev-parse", "HEAD");
}

describe("image impact classification", () => {
  it.each([
    ["apps/web/src/routes/+page.svelte", ["web"]],
    ["apps/worker/src/index.ts", ["worker"]],
    ["apps/sandbox-runner/assets/wrappers/c.sh", ["sandbox"]],
    ["packages/application/src/index.ts", ["web", "worker"]],
    ["packages/mailer/package.json", ["web", "worker"]],
    ["packages/sandbox-docker/src/index.ts", ["worker"]],
    ["packages/storage/src/index.ts", ["web", "worker", "migrator"]],
    ["packages/db/prisma/schema/schema.prisma", ["web", "worker", "migrator"]],
    ["packages/db/src/repositories/user.ts", ["web", "worker"]],
    ["packages/redis/src/index.ts", ["web", "worker"]],
    ["packages/core/src/index.ts", allImages],
    ["infra/docker/web.Dockerfile", ["web"]],
    ["infra/docker/worker.Dockerfile", ["worker"]],
    ["infra/docker/migrator.Dockerfile", ["migrator"]],
    ["infra/docker/sandbox-runner.Dockerfile", ["sandbox"]],
    ["packages/core/README.md", []],
    ["apps/web/build/server.js", []],
    ["docs/architecture/ARCHITECTURE.md", []],
    ["docker-compose.yml", []],
    ["turbo.json", []],
  ])("maps %s to its actual Docker build consumers", (path, expected) => {
    expect(imageNames([path])).toEqual(expected);
  });

  it.each([
    ".dockerignore",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "patches/tree-sitter.patch",
    "tsconfig.base.json",
    "tooling/typescript/base.json",
  ])("maps shared build input %s to every image", (path) => {
    expect(imageNames([path])).toEqual(allImages);
  });

  it("deduplicates images and preserves the fixed matrix order", () => {
    expect(
      classifyImageImpact([
        "apps/sandbox-runner/src/index.ts",
        "apps/web/src/hooks.server.ts",
        "apps/web/package.json",
      ]),
    ).toEqual([
      {
        image: "web",
        dockerfile: "infra/docker/web.Dockerfile",
        tag: "nojv-web",
      },
      {
        image: "sandbox",
        dockerfile: "infra/docker/sandbox-runner.Dockerfile",
        tag: "nojv-sandbox",
      },
    ]);
  });

  it("uses a no-renames diff so deleting an old image input still triggers its build", () => {
    const repository = mkdtempSync(join(tmpdir(), "nojv-image-impact-"));
    try {
      git(repository, "init", "--quiet");
      git(repository, "config", "user.name", "NOJV test");
      git(repository, "config", "user.email", "nojv-test@example.com");
      mkdirSync(join(repository, "apps", "web"), { recursive: true });
      writeFileSync(join(repository, "apps", "web", "old.ts"), "export {};\n");
      const base = commit(repository, "base");

      mkdirSync(join(repository, "docs"), { recursive: true });
      renameSync(join(repository, "apps", "web", "old.ts"), join(repository, "docs", "old.ts"));
      const head = commit(repository, "rename");

      const paths = changedPathsBetween(base, head, repository);
      expect(paths).toEqual(["apps/web/old.ts", "docs/old.ts"]);
      expect(imageNames(paths)).toEqual(["web"]);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("fails closed when either diff endpoint is not a full commit SHA", () => {
    expect(() => changedPathsBetween("main", "0".repeat(40), repoRoot)).toThrow(/BASE_SHA/);
    expect(() => changedPathsBetween("0".repeat(40), "HEAD", repoRoot)).toThrow(/HEAD_SHA/);
  });

  it("writes the selected matrix to GitHub outputs from the CLI", () => {
    const repository = mkdtempSync(join(tmpdir(), "nojv-image-output-"));
    const outputPath = join(repository, "github-output");
    try {
      git(repository, "init", "--quiet");
      git(repository, "config", "user.name", "NOJV test");
      git(repository, "config", "user.email", "nojv-test@example.com");
      writeFileSync(join(repository, "README"), "base\n");
      const base = commit(repository, "base");
      mkdirSync(join(repository, "apps", "web"), { recursive: true });
      mkdirSync(join(repository, "packages", "storage", "src"), { recursive: true });
      writeFileSync(join(repository, "apps", "web", "index.ts"), "export {};\n");
      writeFileSync(join(repository, "packages", "storage", "src", "index.ts"), "export {};\n");
      const head = commit(repository, "image inputs");
      const result = spawnSync(process.execPath, [classifierPath], {
        cwd: repository,
        encoding: "utf8",
        env: {
          ...process.env,
          BASE_SHA: base,
          HEAD_SHA: head,
          GITHUB_OUTPUT: outputPath,
        },
      });

      expect(result).toMatchObject({ status: 0, stderr: "" });
      const output = readFileSync(outputPath, "utf8");
      expect(output).toContain("has_images=true\n");
      expect(output).toContain('"image":"web"');
      expect(output).toContain('"image":"worker"');
      expect(output).toContain('"image":"migrator"');
      expect(output).not.toContain('"image":"sandbox"');
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });
});

describe("Image Build workflow contract", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const trigger = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("concurrency:"));
  const aggregate = workflow.slice(workflow.indexOf("  required-image-build:"));

  it("runs for every pull request with read-only repository permissions", () => {
    expect(trigger.trim()).toBe("on:\n  pull_request:");
    expect(trigger).not.toContain("paths:");
    expect(workflow).toContain("permissions: {}");
    expect(workflow.match(/permissions:\n {6}contents: read/g)).toHaveLength(2);
    expect(workflow).not.toContain("pull_request_target");
  });

  it("classifies the exact base-to-head diff from a credential-free full checkout", () => {
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("BASE_SHA: ${{ github.event.pull_request.base.sha }}");
    expect(workflow).toContain("HEAD_SHA: ${{ github.event.pull_request.head.sha }}");
    expect(workflow).toContain("run: node scripts/classify-image-impact.mjs");
  });

  it("builds only the classifier-provided image matrix", () => {
    expect(workflow).toContain("if: needs.classify.outputs.has_images == 'true'");
    expect(workflow).toContain("include: ${{ fromJSON(needs.classify.outputs.matrix) }}");
    expect(workflow).toContain('docker build -f "$DOCKERFILE" -t "$TAG" .');
    expect(workflow).not.toContain("docker build -f infra/docker/web.Dockerfile");
  });

  it("always emits one fixed required result and rejects every invalid dependency state", () => {
    expect(aggregate).toContain("name: Required image build");
    expect(aggregate).toContain("if: always()");
    expect(aggregate).toContain("needs: [classify, build]");
    expect(aggregate).toContain("CLASSIFY_RESULT: ${{ needs.classify.result }}");
    expect(aggregate).toContain("BUILD_RESULT: ${{ needs.build.result }}");
    expect(aggregate).toContain("HAS_IMAGES: ${{ needs.classify.outputs.has_images }}");
    expect(aggregate).toContain('"$HAS_IMAGES:$BUILD_RESULT" == "true:success"');
    expect(aggregate).toContain('"$HAS_IMAGES:$BUILD_RESULT" == "false:skipped"');
    expect(aggregate).toContain("exit 1");
  });
});
