import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const sharedInputs = [
  ".dockerignore",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "patches/",
  "tsconfig.base.json",
  "tooling/typescript/base.json",
];

const imageDefinitions = [
  {
    image: "web",
    dockerfile: "infra/docker/web.Dockerfile",
    tag: "nojv-web",
    inputs: [
      "infra/docker/web.Dockerfile",
      "apps/web/",
      "packages/core/",
      "packages/db/",
      "packages/application/",
      "packages/redis/",
      "packages/storage/",
      "packages/mailer/",
      "packages/temporal/",
    ],
  },
  {
    image: "worker",
    dockerfile: "infra/docker/worker.Dockerfile",
    tag: "nojv-worker",
    inputs: [
      "infra/docker/worker.Dockerfile",
      "apps/worker/",
      "packages/core/",
      "packages/db/",
      "packages/temporal/",
      "packages/application/",
      "packages/redis/",
      "packages/storage/",
      "packages/mailer/",
      "packages/sandbox-docker/",
    ],
  },
  {
    image: "migrator",
    dockerfile: "infra/docker/migrator.Dockerfile",
    tag: "nojv-migrator",
    inputs: [
      "infra/docker/migrator.Dockerfile",
      "packages/core/",
      "packages/storage/",
      "packages/db/package.json",
      "packages/db/prisma.config.ts",
      "packages/db/prisma/",
    ],
  },
  {
    image: "sandbox",
    dockerfile: "infra/docker/sandbox-runner.Dockerfile",
    tag: "nojv-sandbox",
    inputs: [
      "infra/docker/sandbox-runner.Dockerfile",
      "apps/sandbox-runner/",
      "packages/core/",
    ],
  },
];

function matchesInput(path, input) {
  return input.endsWith("/") ? path.startsWith(input) : path === input;
}

function isExcludedFromBuildContext(path) {
  const segments = path.split("/");
  const basename = segments.at(-1) ?? "";
  return (
    basename.endsWith(".md") ||
    basename.startsWith(".env") ||
    segments.some((segment) =>
      ["node_modules", ".git", ".turbo", "dist", "build", ".svelte-kit", ".next"].includes(
        segment,
      ),
    )
  );
}

export function classifyImageImpact(changedPaths) {
  const contextPaths = changedPaths.filter(
    (path) => path === ".dockerignore" || !isExcludedFromBuildContext(path),
  );

  return imageDefinitions
    .filter(({ inputs }) =>
      contextPaths.some((path) =>
        [...sharedInputs, ...inputs].some((input) => matchesInput(path, input)),
      ),
    )
    .map(({ image, dockerfile, tag }) => ({ image, dockerfile, tag }));
}

function validateSha(name, value) {
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${name} must be a full 40-character lowercase commit SHA`);
  }
}

export function changedPathsBetween(baseSha, headSha, cwd = process.cwd()) {
  validateSha("BASE_SHA", baseSha);
  validateSha("HEAD_SHA", headSha);
  const output = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", baseSha, headSha],
    { cwd, encoding: "utf8" },
  );
  return output.split("\n").filter(Boolean);
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function main() {
  const matrix = classifyImageImpact(
    changedPathsBetween(requiredEnvironment("BASE_SHA"), requiredEnvironment("HEAD_SHA")),
  );
  const outputPath = requiredEnvironment("GITHUB_OUTPUT");
  appendFileSync(
    outputPath,
    `has_images=${matrix.length > 0}\nmatrix=${JSON.stringify(matrix)}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
