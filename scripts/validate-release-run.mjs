#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const RELEASE_PACKAGES = ["nojv-web", "nojv-worker", "nojv-migrator", "nojv-sandbox"];

function requireValue(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`release ${label} must be ${expected}, received ${actual || "<empty>"}`);
  }
}

export function validateReleaseRun(input) {
  if (!input.expectedRepository) throw new Error("expected repository is required");

  requireValue("workflow name", input.workflowName, "CI");
  requireValue("workflow path", input.workflowPath, ".github/workflows/ci.yml");
  requireValue("event", input.event, "push");
  requireValue("conclusion", input.conclusion, "success");
  requireValue("branch", input.branch, "main");
  requireValue("repository", input.repository, input.expectedRepository);

  if (!SHA_PATTERN.test(input.releaseSha)) {
    throw new Error("release SHA must be a lowercase 40-character commit SHA");
  }
  if (input.checkedOutSha !== input.releaseSha) {
    throw new Error(
      `checked-out SHA ${input.checkedOutSha || "<empty>"} does not match release SHA ${input.releaseSha}`,
    );
  }

  return { releaseSha: input.releaseSha, imageTag: input.releaseSha };
}

export function validateDeployAdvance(input) {
  if (!SHA_PATTERN.test(input.releaseSha)) {
    throw new Error("release SHA must be a lowercase 40-character commit SHA");
  }

  const [deployTip, deployedRelease, ...extraParents] = input.deployCommitLine
    .trim()
    .split(/\s+/);
  if (
    !SHA_PATTERN.test(deployTip ?? "") ||
    !SHA_PATTERN.test(deployedRelease ?? "") ||
    extraParents.length > 0
  ) {
    throw new Error("deploy ref must point to a single-parent release commit");
  }
  if (!input.isAncestor(deployedRelease, input.releaseSha)) {
    throw new Error(
      `release SHA ${input.releaseSha} would move deploy backwards from ${deployedRelease}`,
    );
  }

  return { deployTip };
}

/**
 * @param {{
 *   releaseSha: string;
 *   remoteDeployTags: string[];
 *   packageTags: Record<string, string[]>;
 * }} input
 */
export function validatePublicationAbsence(input) {
  if (!SHA_PATTERN.test(input.releaseSha)) {
    throw new Error("release SHA must be a lowercase 40-character commit SHA");
  }

  const deployTag = `refs/tags/nojv-deploy-${input.releaseSha}`;
  if (input.remoteDeployTags.includes(deployTag)) {
    throw new Error(`immutable deploy tag already exists: ${deployTag}`);
  }

  for (const packageName of RELEASE_PACKAGES) {
    if ((input.packageTags[packageName] ?? []).includes(input.releaseSha)) {
      throw new Error(`immutable GHCR tag already exists: ${packageName}:${input.releaseSha}`);
    }
  }
}

async function listPackageTags({ apiRoot, owner, packageName, token }) {
  const tags = [];
  for (let page = 1; ; page += 1) {
    const url = new URL(
      `/orgs/${encodeURIComponent(owner)}/packages/container/${encodeURIComponent(packageName)}/versions`,
      apiRoot,
    );
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (response.status === 404 && page === 1) return tags;
    if (!response.ok) {
      throw new Error(
        `GitHub package lookup failed for ${packageName}: ${response.status} ${response.statusText}`,
      );
    }
    const versions = await response.json();
    if (!Array.isArray(versions)) {
      throw new Error(`GitHub package lookup returned invalid data for ${packageName}`);
    }
    for (const version of versions) {
      const versionTags = version?.metadata?.container?.tags;
      if (!Array.isArray(versionTags) || !versionTags.every((tag) => typeof tag === "string")) {
        throw new Error(`GitHub package lookup returned invalid tags for ${packageName}`);
      }
      tags.push(...versionTags);
    }
    if (versions.length < 100) return tags;
  }
}

function writeOutputs(output) {
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
  appendFileSync(process.env.GITHUB_OUTPUT, output);
}

function validateReleaseRunFromEnvironment() {
  const checkedOutSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const release = validateReleaseRun({
    workflowName: process.env.RELEASE_WORKFLOW_NAME,
    workflowPath: process.env.RELEASE_WORKFLOW_PATH,
    event: process.env.RELEASE_EVENT,
    conclusion: process.env.RELEASE_CONCLUSION,
    branch: process.env.RELEASE_BRANCH,
    repository: process.env.RELEASE_REPOSITORY,
    expectedRepository: process.env.GITHUB_REPOSITORY,
    releaseSha: process.env.RELEASE_SHA,
    checkedOutSha,
  });
  writeOutputs(`release_sha=${release.releaseSha}\nimage_tag=${release.imageTag}\n`);
}

function validateDeployAdvanceFromEnvironment() {
  const deployCommitLine = execFileSync(
    "git",
    ["rev-list", "--parents", "-n", "1", "refs/remotes/origin/deploy"],
    { encoding: "utf8" },
  );
  const release = validateDeployAdvance({
    releaseSha: process.env.RELEASE_SHA,
    deployCommitLine,
    isAncestor: (ancestor, candidate) => {
      const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, candidate], {
        encoding: "utf8",
      });
      if (result.status === 0) return true;
      if (result.status === 1) return false;
      throw new Error(result.stderr.trim() || "git merge-base failed");
    },
  });
  writeOutputs(`deploy_tip=${release.deployTip}\n`);
}

async function validatePublicationAbsenceFromEnvironment() {
  const releaseSha = process.env.RELEASE_SHA ?? "";
  const owner = process.env.PACKAGE_OWNER ?? "";
  const token = process.env.GH_TOKEN ?? "";
  const apiRoot = process.env.GITHUB_API_ROOT ?? "";
  if (!owner || !token || !apiRoot) {
    throw new Error("PACKAGE_OWNER, GH_TOKEN, and GITHUB_API_ROOT are required");
  }
  const deployTag = `refs/tags/nojv-deploy-${releaseSha}`;
  const remoteDeployTags = execFileSync("git", ["ls-remote", "--tags", "origin", deployTag], {
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim().split(/\s+/u)[1])
    .filter(Boolean);
  const packageTags = Object.fromEntries(
    await Promise.all(
      RELEASE_PACKAGES.map(async (packageName) => [
        packageName,
        await listPackageTags({ apiRoot, owner, packageName, token }),
      ]),
    ),
  );
  validatePublicationAbsence({ releaseSha, remoteDeployTags, packageTags });
}

async function main() {
  const mode = process.argv[2] ?? "release-run";
  if (mode === "release-run") return validateReleaseRunFromEnvironment();
  if (mode === "deploy-advance") return validateDeployAdvanceFromEnvironment();
  if (mode === "publication-absence") return validatePublicationAbsenceFromEnvironment();
  throw new Error(`unknown validation mode: ${mode}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
