import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  validateCloudBuildProvenance,
  validatePublicationState,
  validatePublishedImage,
  validateReleaseRun,
} from "../../../scripts/validate-release-run.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workflowPath = join(repoRoot, ".github/workflows/build-images.yml");
const imageBuilderPath = join(repoRoot, "scripts/build-release-image.sh");
const imagePromoterPath = join(repoRoot, "scripts/promote-release-image.sh");
const ciWorkflowPath = join(repoRoot, ".github/workflows/ci.yml");
const validatorPath = join(repoRoot, "scripts/validate-release-run.mjs");
const checkedOutSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();

const releaseTag = "v1.2.3";
const successfulCheck = {
  name: "Verify Repository",
  head_sha: checkedOutSha,
  status: "completed",
  conclusion: "success",
  app: { slug: "github-actions" },
};
const validRelease = {
  event: "push",
  ref: `refs/tags/${releaseTag}`,
  refName: releaseTag,
  repository: "NOJV-TW/NOJV",
  expectedRepository: "NOJV-TW/NOJV",
  releaseSha: checkedOutSha,
  checkedOutSha,
  mainContainsRelease: true,
  checkRuns: [successfulCheck],
};

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

  it("accepts only a stable version tag on a main commit with the required CI check", () => {
    expect(validateReleaseRun(validRelease)).toEqual({
      releaseSha: checkedOutSha,
      imageTag: releaseTag,
    });
  });

  it.each([
    ["prerelease tag", { ref: "refs/tags/v1.2.3-rc.1", refName: "v1.2.3-rc.1" }, /vX\.Y\.Z/],
    ["non-version tag", { ref: "refs/tags/latest", refName: "latest" }, /vX\.Y\.Z/],
    ["branch push", { ref: "refs/heads/main", refName: "main" }, /vX\.Y\.Z/],
    ["pull request event", { event: "pull_request" }, /event/],
    ["fork repository", { repository: "attacker/NOJV" }, /repository/],
    ["non-SHA release", { releaseSha: "main" }, /40-character/],
    ["checked-out SHA mismatch", { releaseSha: "0".repeat(40) }, /checked-out SHA/],
    ["commit outside main", { mainContainsRelease: false }, /main/],
    [
      "failed CI",
      { checkRuns: [{ ...successfulCheck, conclusion: "failure" }] },
      /Verify Repository/,
    ],
    ["missing CI", { checkRuns: [] }, /Verify Repository/],
  ])("rejects %s", (_name, overrides, expectedError) => {
    expect(() => validateReleaseRun({ ...validRelease, ...overrides })).toThrow(expectedError);
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

describe("immutable publication preflight", () => {
  const releaseSha = "a".repeat(40);
  const imageTag = "v1.2.3";

  it("accepts a version absent from the deploy ref and every runtime package", () => {
    expect(
      validatePublicationState({
        releaseSha,
        imageTag,
        remoteDeployTags: [],
        packageTags: {},
      }),
    ).toEqual({ existingImages: [] });
  });

  it("rejects a completed same-SHA release before package publication", () => {
    expect(() =>
      validatePublicationState({
        releaseSha,
        imageTag,
        remoteDeployTags: [`refs/tags/nojv-deploy-${imageTag}`],
        packageTags: {},
      }),
    ).toThrow(/deploy tag already exists/u);
  });

  it("returns a partial same-SHA publication for provenance validation and reuse", () => {
    expect(
      validatePublicationState({
        releaseSha,
        imageTag,
        remoteDeployTags: [],
        packageTags: { "nojv-worker": [imageTag] },
      }),
    ).toEqual({ existingImages: ["nojv-worker"] });
  });

  it("validates the immutable digest and OCI source identity before reusing an image", () => {
    const ref = "ghcr.io/nojv-tw/nojv-worker";
    const digest = `sha256:${"1".repeat(64)}`;
    expect(
      validatePublishedImage({
        releaseSha,
        imageTag,
        ref,
        inspect: [
          {
            RepoTags: [`${ref}:${imageTag}`],
            RepoDigests: [`${ref}@${digest}`],
            Config: {
              Labels: {
                "org.opencontainers.image.revision": releaseSha,
                "org.opencontainers.image.version": imageTag,
              },
            },
          },
        ],
      }),
    ).toEqual({ digest });
  });

  it.each([
    [
      "wrong revision",
      {
        "org.opencontainers.image.revision": "b".repeat(40),
        "org.opencontainers.image.version": imageTag,
      },
      [`ghcr.io/nojv-tw/nojv-worker@sha256:${"1".repeat(64)}`],
      /revision/u,
    ],
    [
      "missing digest",
      {
        "org.opencontainers.image.revision": releaseSha,
        "org.opencontainers.image.version": imageTag,
      },
      [],
      /digest/u,
    ],
  ])("rejects a reusable image with %s", (_name, labels, repoDigests, error) => {
    const ref = "ghcr.io/nojv-tw/nojv-worker";
    expect(() =>
      validatePublishedImage({
        releaseSha,
        imageTag,
        ref,
        inspect: [
          {
            RepoTags: [`${ref}:${imageTag}`],
            RepoDigests: repoDigests,
            Config: { Labels: labels },
          },
        ],
      }),
    ).toThrow(error as RegExp);
  });
});

describe("Cloud Build provenance validator", () => {
  const releaseSha = "a".repeat(40);
  const digest = `sha256:${"1".repeat(64)}`;
  const trustedProvenance = {
    _type: "https://in-toto.io/Statement/v1",
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [
      {
        name: "https://asia-east1-docker.pkg.dev/nojv-prod/nojv/worker",
        digest: { sha256: "1".repeat(64) },
      },
      {
        name: `https://asia-east1-docker.pkg.dev/nojv-prod/nojv/worker:${releaseSha}`,
        digest: { sha256: "1".repeat(64) },
      },
    ],
    predicate: {
      buildDefinition: {
        buildType: "https://cloud.google.com/build/gcb-buildtypes/google-worker/v1",
        resolvedDependencies: [
          {
            uri: `git+https://github.com/NOJV-TW/NOJV.git@${releaseSha}`,
            digest: { gitCommit: releaseSha },
          },
        ],
        externalParameters: {
          substitutions: {
            _COMPONENT: "worker",
            _DOCKERFILE: "infra/docker/worker.Dockerfile",
            _REGION: "asia-east1",
            _REPOSITORY: "nojv",
            _SOURCE_SHA: releaseSha,
          },
        },
      },
      runDetails: {
        builder: {
          id: "https://cloudbuild.googleapis.com/GoogleHostedWorker",
        },
      },
    },
  };
  const input = {
    digest,
    imageRef: "asia-east1-docker.pkg.dev/nojv-prod/nojv/worker",
    provenance: trustedProvenance,
    component: "worker",
    dockerfile: "infra/docker/worker.Dockerfile",
    region: "asia-east1",
    repository: "nojv",
    releaseSha,
    sourceUri: "git+https://github.com/NOJV-TW/NOJV.git",
  };

  it("accepts a matching Google-hosted SLSA build", () => {
    expect(validateCloudBuildProvenance(input)).toEqual({ digest });
  });

  it("rejects provenance copied from another component", () => {
    expect(() => validateCloudBuildProvenance({ ...input, component: "web" })).toThrow(
      /lacks trusted Cloud Build SLSA provenance/u,
    );
  });

  it("rejects a signed build from another source repository", () => {
    const provenance = structuredClone(trustedProvenance);
    provenance.predicate.buildDefinition.resolvedDependencies[0].uri =
      "git+https://github.com/attacker/NOJV.git";
    expect(() => validateCloudBuildProvenance({ ...input, provenance })).toThrow(
      /lacks trusted Cloud Build SLSA provenance/u,
    );
  });

  it("rejects an unrelated subject even when its digest matches", () => {
    const provenance = structuredClone(trustedProvenance);
    provenance.subject.push({
      name: "https://asia-east1-docker.pkg.dev/attacker/repo/worker",
      digest: { sha256: "1".repeat(64) },
    });
    expect(() => validateCloudBuildProvenance({ ...input, provenance })).toThrow(
      /does not bind the published image digest/u,
    );
  });
});

describe("Build & Push Images workflow release structure", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const imageBuilder = readFileSync(imageBuilderPath, "utf8");
  const imagePromoter = readFileSync(imagePromoterPath, "utf8");
  const validator = readFileSync(validatorPath, "utf8");
  const trigger = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("concurrency:"));
  const jobSection = (jobId: string) => {
    const marker = `  ${jobId}:`;
    const start = workflow.indexOf(marker);
    if (start < 0) return "";
    const remainder = workflow.slice(start + marker.length);
    const nextJob = remainder.search(/\n {2}[a-z][a-z0-9-]*:\n/u);
    return workflow.slice(start, nextJob < 0 ? undefined : start + marker.length + nextJob);
  };
  const prepareJob = jobSection("prepare-release");
  const imageComponents = ["web", "worker", "migrator", "sandbox"];
  const imageJobs = imageComponents.map((component) => jobSection(`build-${component}`));
  const releaseJobs = workflow.slice(
    workflow.indexOf("  prepare-release:"),
    workflow.indexOf("  deploy-ref:"),
  );
  const deployJob = jobSection("deploy-ref");

  it("builds all four release images in independent jobs before deploy", () => {
    expect(prepareJob).not.toBe("");
    expect(workflow).not.toContain("  build-publish:");
    for (const job of imageJobs) {
      expect(job).not.toBe("");
      expect(job).toContain("needs: prepare-release");
      expect(job).not.toMatch(/needs: build-(web|worker|migrator|sandbox)/u);
      expect(job).toContain("run: scripts/build-release-image.sh");
    }
    for (const dependency of [
      "prepare-release",
      "build-web",
      "build-worker",
      "build-migrator",
      "build-sandbox",
    ]) {
      expect(deployJob).toContain(`- ${dependency}`);
    }
  });

  it("listens only for stable-looking version tag pushes", () => {
    expect(trigger.trim()).toBe(["on:", "  push:", "    tags:", '      - "v*.*.*"'].join("\n"));
    expect(workflow).toContain("group: build-images-release\n  cancel-in-progress: false");
  });

  it("fails closed before package writes unless the tag commit passed main CI", () => {
    expect(prepareJob).toContain("github.event_name == 'push'");
    expect(prepareJob).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(prepareJob).toContain("github.repository == 'NOJV-TW/NOJV'");
    expect(prepareJob).toContain(
      "git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main",
    );
    expect(prepareJob).toContain("checks: read");
    expect(prepareJob).toContain("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
    expect(validator).toContain("/commits/${releaseSha}/check-runs");
    expect(validator).toContain('"Verify Repository"');
    expect(prepareJob).toContain("run: node scripts/validate-release-run.mjs");
  });

  it("binds checkout and all four images to the source SHA and immutable version tag", () => {
    expect(prepareJob).toContain("ref: ${{ github.ref }}");
    expect(prepareJob).toContain("persist-credentials: false");
    expect(prepareJob).toContain("release_sha: ${{ steps.release.outputs.release_sha }}");
    expect(prepareJob).toContain("image_tag: ${{ steps.release.outputs.image_tag }}");
    expect(releaseJobs.match(/run: scripts\/build-release-image\.sh/gu)).toHaveLength(4);
    for (const job of imageJobs) {
      expect(job).toContain("ref: ${{ needs.prepare-release.outputs.release_sha }}");
      expect(job).toContain("persist-credentials: false");
    }
    expect(releaseJobs).not.toContain("git rev-parse --short");
  });

  it("detects same-version publication state before any package write", () => {
    expect(prepareJob).not.toContain("packages: write");
    expect(prepareJob).not.toContain("publication-state");
    for (const job of imageJobs) {
      const publicationState = job.indexOf(
        "run: node scripts/validate-release-run.mjs publication-state",
      );
      expect(publicationState).toBeGreaterThan(0);
      expect(publicationState).toBeLessThan(job.indexOf("run: scripts/build-release-image.sh"));
      expect(job).toContain("RELEASE_SHA: ${{ needs.prepare-release.outputs.release_sha }}");
      expect(job).toContain("IMAGE_TAG: ${{ needs.prepare-release.outputs.image_tag }}");
      expect(job).toContain("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
      expect(job).toContain(
        "EXISTING_IMAGES: ${{ steps.publication.outputs.existing_images }}",
      );
    }
    expect(imageBuilder).toContain("node scripts/validate-release-run.mjs published-image");
    expect(imageBuilder).toContain('gh attestation verify "oci://${ref}@${digest}"');
    expect(imageBuilder).toContain(
      '--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/build-images.yml"',
    );
    expect(imageBuilder).toContain('--source-ref "refs/tags/${TAG}"');
    expect(imageBuilder).toContain('--source-digest "$RELEASE_SHA"');
    expect(imageBuilder).toContain("--deny-self-hosted-runners");
    expect(
      releaseJobs.match(/uses: actions\/attest@a1948c3f048ba23858d222213b7c278aabede763/gu),
    ).toHaveLength(4);
    expect(imageBuilder).toContain("org.opencontainers.image.revision=${RELEASE_SHA}");
    expect(imageBuilder).toContain("org.opencontainers.image.version=${TAG}");
    expect(imageBuilder).toContain("${TAG}-candidate-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}");
    expect(imageBuilder).not.toContain('--tag "${ref}:${TAG}"');
    expect(imagePromoter).toContain(
      'docker buildx imagetools create --tag "${ref}:${TAG}" "${ref}@${IMAGE_DIGEST}"',
    );
    imageJobs.forEach((job, index) => {
      const component = imageComponents[index];
      const retrySafeOrder = [
        "id: image",
        `name: Attest ${component} image`,
        `name: Publish ${component} release tag`,
      ].map((marker) => job.indexOf(marker));
      expect(retrySafeOrder.every((position) => position >= 0)).toBe(true);
      expect(retrySafeOrder).toEqual([...retrySafeOrder].sort((a, b) => a - b));
    });
  });

  it("keeps package and repository writes in separate least-privilege jobs", () => {
    expect(workflow).toContain("permissions: {}");
    expect(prepareJob).toMatch(/permissions:\n {6}checks: read\n {6}contents: read/u);
    for (const job of imageJobs) {
      expect(job).toMatch(
        /permissions:\n {6}attestations: write\n {6}contents: read\n {6}id-token: write\n {6}packages: write/u,
      );
      expect(job).not.toContain("contents: write");
      expect(job).not.toContain("git checkout -B deploy");
    }

    for (const dependency of [
      "prepare-release",
      "build-web",
      "build-worker",
      "build-migrator",
      "build-sandbox",
    ]) {
      expect(deployJob).toContain(`- ${dependency}`);
    }
    expect(deployJob).toMatch(/permissions:\n {6}contents: write/);
    expect(deployJob).not.toContain("packages: write");
    expect(deployJob).not.toContain("docker buildx build");
  });

  it("updates deploy only from the successful preflight and four image digests", () => {
    expect(deployJob).toContain("ref: ${{ needs.prepare-release.outputs.release_sha }}");
    expect(deployJob).toContain(
      "RELEASE_SHA: ${{ needs.prepare-release.outputs.release_sha }}",
    );
    expect(deployJob).toContain("IMAGE_TAG: ${{ needs.prepare-release.outputs.image_tag }}");
    for (const component of imageComponents) {
      expect(deployJob).toContain(
        `IMAGE_DIGEST_${component.toUpperCase()}: \${{ needs.build-${component}.outputs.digest }}`,
      );
    }
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

describe("main release trigger coverage", () => {
  const ciWorkflow = readFileSync(ciWorkflowPath, "utf8");
  const trigger = ciWorkflow.slice(
    ciWorkflow.indexOf("on:"),
    ciWorkflow.indexOf("concurrency:"),
  );

  it("runs CI for Flux-only changes so every main revision can reach the deploy branch", () => {
    expect(trigger).toContain("push:\n    branches:\n      - main");
    expect(trigger).not.toContain("paths-ignore:");
    expect(trigger).not.toContain('"infra/flux/**"');
  });
});
