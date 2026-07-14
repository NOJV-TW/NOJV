import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workflowPath = join(repoRoot, ".github/workflows/build-images.yml");
const validatorPath = join(repoRoot, "scripts/validate-release-run.mjs");
const checkedOutSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();

const validReleaseEnv = {
  GITHUB_REPOSITORY: "NOJV-TW/NOJV",
  RELEASE_WORKFLOW_NAME: "CI",
  RELEASE_WORKFLOW_PATH: ".github/workflows/ci.yml",
  RELEASE_EVENT: "push",
  RELEASE_CONCLUSION: "success",
  RELEASE_BRANCH: "main",
  RELEASE_REPOSITORY: "NOJV-TW/NOJV",
  RELEASE_SHA: checkedOutSha,
};

function runValidator(overrides: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "nojv-release-gate-"));
  const outputPath = join(directory, "github-output");
  try {
    const result = spawnSync(process.execPath, [validatorPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ...validReleaseEnv,
        ...overrides,
        GITHUB_OUTPUT: outputPath,
      },
    });
    return {
      status: result.status,
      stderr: result.stderr,
      output: existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "",
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function git(repository: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
}

function commit(repository: string, name: string): string {
  writeFileSync(join(repository, "state"), name);
  git(repository, "add", "state");
  git(repository, "commit", "-m", name);
  return git(repository, "rev-parse", "HEAD");
}

function runDeployAdvance(candidate: "older" | "current" | "newer") {
  const repository = mkdtempSync(join(tmpdir(), "nojv-deploy-advance-"));
  try {
    git(repository, "init", "--quiet");
    git(repository, "config", "user.name", "NOJV test");
    git(repository, "config", "user.email", "nojv-test@example.com");
    commit(repository, "base");
    const older = commit(repository, "older");
    const current = commit(repository, "current");

    writeFileSync(join(repository, "deploy"), "current");
    git(repository, "add", "deploy");
    git(repository, "commit", "-m", "deploy current");
    const deployTip = git(repository, "rev-parse", "HEAD");
    git(repository, "update-ref", "refs/remotes/origin/deploy", deployTip);

    git(repository, "checkout", "--quiet", "--detach", current);
    const newer = commit(repository, "newer");
    const outputPath = join(repository, "github-output");
    const result = spawnSync(process.execPath, [validatorPath, "deploy-advance"], {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputPath,
        RELEASE_SHA: { older, current, newer }[candidate],
      },
    });
    return {
      status: result.status,
      stderr: result.stderr,
      output: existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "",
      deployTip,
    };
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
}

describe("trusted release-run validator", () => {
  it("exports its pure validator without executing the CLI", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { validateReleaseRun } from ${JSON.stringify(validatorPath)}; process.stdout.write(typeof validateReleaseRun)`,
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(result).toMatchObject({ status: 0, stdout: "function", stderr: "" });
  });

  it("accepts only the successful repository CI run for the exact checked-out main SHA", () => {
    expect(runValidator()).toEqual({
      status: 0,
      stderr: "",
      output: `release_sha=${checkedOutSha}\nimage_tag=${checkedOutSha}\n`,
    });
  });

  it.each([
    ["failed CI", { RELEASE_CONCLUSION: "failure" }, /conclusion/],
    ["cancelled CI", { RELEASE_CONCLUSION: "cancelled" }, /conclusion/],
    ["non-main branch", { RELEASE_BRANCH: "feature" }, /branch/],
    ["pull request event", { RELEASE_EVENT: "pull_request" }, /event/],
    ["other workflow", { RELEASE_WORKFLOW_NAME: "Image Build" }, /workflow name/],
    ["other workflow path", { RELEASE_WORKFLOW_PATH: ".github/workflows/fake.yml" }, /path/],
    ["fork repository", { RELEASE_REPOSITORY: "attacker/NOJV" }, /repository/],
    ["non-SHA ref", { RELEASE_SHA: "main" }, /40-character/],
    ["checked-out SHA mismatch", { RELEASE_SHA: "0".repeat(40) }, /checked-out SHA/],
  ])("rejects %s", (_name, overrides, expectedError) => {
    const result = runValidator(overrides);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(expectedError);
    expect(result.output).toBe("");
  });
});

describe("monotonic deploy validator", () => {
  it.each(["current", "newer"] as const)("accepts a %s main release", (candidate) => {
    const result = runDeployAdvance(candidate);
    expect(result).toMatchObject({
      status: 0,
      stderr: "",
      output: `deploy_tip=${result.deployTip}\n`,
    });
  });

  it("rejects an old successful CI rerun after deploy has advanced", () => {
    const result = runDeployAdvance("older");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/would move deploy backwards/);
    expect(result.output).toBe("");
  });
});

describe("Build & Push Images workflow release structure", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const trigger = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("concurrency:"));
  const buildJob = workflow.slice(
    workflow.indexOf("  build-publish:"),
    workflow.indexOf("  deploy-ref:"),
  );
  const deployJob = workflow.slice(workflow.indexOf("  deploy-ref:"));

  it("has no push or manual release path and listens only for completed main CI runs", () => {
    expect(trigger.trim()).toBe(
      [
        "on:",
        "  workflow_run:",
        "    workflows: [CI]",
        "    types: [completed]",
        "    branches: [main]",
      ].join("\n"),
    );
    expect(workflow).toContain("group: build-images-main\n  cancel-in-progress: false");
  });

  it("fails closed at the job boundary for repository push CI success only", () => {
    for (const condition of [
      "workflow_run.name == 'CI'",
      "workflow_run.path == '.github/workflows/ci.yml'",
      "workflow_run.event == 'push'",
      "workflow_run.conclusion == 'success'",
      "workflow_run.head_branch == 'main'",
      "workflow_run.head_repository.full_name == github.repository",
    ]) {
      expect(buildJob).toContain(condition);
    }
    expect(buildJob).toContain("run: node scripts/validate-release-run.mjs");
  });

  it("binds checkout, all four image builds and the immutable image tag to head_sha", () => {
    expect(buildJob).toContain("ref: ${{ github.event.workflow_run.head_sha }}");
    expect(buildJob).toContain("persist-credentials: false");
    expect(buildJob).toContain("release_sha: ${{ steps.release.outputs.release_sha }}");
    expect(buildJob).toContain("image_tag: ${{ steps.release.outputs.image_tag }}");
    expect(buildJob.match(/build nojv-/g)).toHaveLength(4);
    expect(buildJob).not.toContain(':main"');
    expect(buildJob).not.toContain("git rev-parse --short");
  });

  it("keeps package and repository writes in separate least-privilege jobs", () => {
    expect(workflow).toContain("permissions: {}");
    expect(buildJob).toMatch(/permissions:\n {6}contents: read\n {6}packages: write/);
    expect(buildJob).not.toContain("contents: write");
    expect(buildJob).not.toContain("git checkout -B deploy");

    expect(deployJob).toContain("needs: build-publish");
    expect(deployJob).toMatch(/permissions:\n {6}contents: write/);
    expect(deployJob).not.toContain("packages: write");
    expect(deployJob).not.toContain("docker buildx build");
  });

  it("updates deploy only from the successful four-image job's exact SHA outputs", () => {
    expect(deployJob).toContain("ref: ${{ needs.build-publish.outputs.release_sha }}");
    expect(deployJob).toContain("RELEASE_SHA: ${{ needs.build-publish.outputs.release_sha }}");
    expect(deployJob).toContain("IMAGE_TAG: ${{ needs.build-publish.outputs.image_tag }}");
    expect(deployJob).toContain('test "$(git rev-parse HEAD)" = "$RELEASE_SHA"');
    expect(deployJob).toContain(
      "git fetch --no-tags origin +refs/heads/deploy:refs/remotes/origin/deploy",
    );
    expect(deployJob).toContain("run: node scripts/validate-release-run.mjs deploy-advance");
    expect(deployJob).toContain("DEPLOY_TIP: ${{ steps.advance.outputs.deploy_tip }}");
    expect(deployJob).toContain('"--force-with-lease=refs/heads/deploy:${DEPLOY_TIP}"');
    expect(deployJob).not.toContain("git push --atomic --force origin");
  });
});
