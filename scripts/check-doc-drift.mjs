#!/usr/bin/env node
import { globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const BANNED = [/packages\/domain\b/, /@nojv\/domain\b/];

const files = ["AGENT.md", "README.md", ...globSync("docs/**/*.md", { cwd: repoRoot })];

const staleDomainReferences = [];
for (const rel of files) {
  let source;
  try {
    source = readFileSync(resolve(repoRoot, rel), "utf8");
  } catch {
    continue;
  }
  source.split("\n").forEach((line, i) => {
    if (BANNED.some((re) => re.test(line))) {
      staleDomainReferences.push(`${rel}:${String(i + 1)}: ${line.trim()}`);
    }
  });
}

if (staleDomainReferences.length > 0) {
  console.error("Stale 'domain' package reference (the package is @nojv/application):");
  for (const reference of staleDomainReferences) console.error(`  ${reference}`);
  process.exit(1);
}

const judgeEnvironment = JSON.parse(
  readFileSync(resolve(repoRoot, "packages/core/src/judge-environment.json"), "utf8"),
);
const deploymentGuide = readFileSync(
  resolve(repoRoot, "docs/operations/DEPLOYMENT.md"),
  "utf8",
);
const requiredToolchainReferences = [
  `${judgeEnvironment.platform.name} ${judgeEnvironment.platform.version}`,
  `Node.js ${judgeEnvironment.platform.nodeVersion}`,
  ...Object.entries(judgeEnvironment.apkPackages).map(
    ([name, version]) => `${name}=${version}`,
  ),
];
const toolchainSectionHeading = "#### Standard judge toolchain";
const toolchainSectionStart = deploymentGuide.indexOf(toolchainSectionHeading);
const toolchainSectionEnd = deploymentGuide.indexOf(
  "\n### ",
  toolchainSectionStart + toolchainSectionHeading.length,
);
if (toolchainSectionStart < 0 || toolchainSectionEnd < 0) {
  console.error(`Deployment guide is missing the ${toolchainSectionHeading} section.`);
  process.exit(1);
}

const toolchainSection = deploymentGuide.slice(toolchainSectionStart, toolchainSectionEnd);
const toolchainTableStart = toolchainSection.indexOf("| Component");
const toolchainTableEnd = toolchainSection.indexOf("\n\n", toolchainTableStart);
if (toolchainTableStart < 0 || toolchainTableEnd < 0) {
  console.error("Deployment guide is missing the standard judge toolchain table.");
  process.exit(1);
}

const toolchainTable = toolchainSection.slice(toolchainTableStart, toolchainTableEnd);
const documentedToolchainReferences = [...toolchainTable.matchAll(/`([^`\n]+)`/g)].map(
  (match) => match[1],
);
const requiredToolchainReferenceSet = new Set(requiredToolchainReferences);
const documentedToolchainReferenceSet = new Set(documentedToolchainReferences);
const missingToolchainReferences = requiredToolchainReferences.filter(
  (reference) => !documentedToolchainReferenceSet.has(reference),
);
const staleToolchainReferences = documentedToolchainReferences.filter(
  (reference) => !requiredToolchainReferenceSet.has(reference),
);

if (missingToolchainReferences.length > 0 || staleToolchainReferences.length > 0) {
  if (missingToolchainReferences.length > 0) {
    console.error("Deployment guide is missing pinned judge environment versions:");
    for (const reference of missingToolchainReferences) console.error(`  ${reference}`);
  }
  if (staleToolchainReferences.length > 0) {
    console.error("Deployment guide contains stale judge environment versions:");
    for (const reference of staleToolchainReferences) console.error(`  ${reference}`);
  }
  process.exit(1);
}
console.log("check-doc-drift: clean");
