import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ACTION_SHA = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[a-f0-9]{40}$/u;
const VERSIONED_URL = /(?:^|[/_.-])v?\d+\.\d+\.\d+(?:[/_.-]|$)|[0-9a-f]{40}/u;
const SHA256 = /[a-f0-9]{64}/u;
const IMMUTABLE_IMAGE =
  /^(?:[a-z0-9.-]+(?::[0-9]+)?\/)?(?:[a-z0-9._-]+\/)*[a-z0-9._-]+:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}@sha256:[a-f0-9]{64}$/u;
const IMAGE_REFERENCE =
  /^(?:[a-z0-9.-]+(?::[0-9]+)?\/)?(?:[a-z0-9._-]+\/)*[a-z0-9._-]+:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}(?:@sha256:[a-f0-9]{64})?$/u;
const IMAGE_LITERAL_FILES = new Set([
  "apps/worker/src/activities/registry.ts",
  "apps/worker/src/env.ts",
  "apps/worker/src/services/k8s-netpol-probe.ts",
  "packages/db/prisma/seeds/problems.ts",
]);

function violation(file, line, message) {
  return { file, line, message };
}

function logicalCommand(lines, start) {
  let end = start;
  while (end < lines.length - 1 && lines[end].trimEnd().endsWith("\\")) end += 1;
  return { command: lines.slice(start, end + 1).join(" "), end };
}

function isDockerfile(file) {
  const name = file.split("/").at(-1) ?? "";
  return name === "Dockerfile" || name.endsWith(".Dockerfile");
}

function imageReferences(file, line, index, lines) {
  if (isDockerfile(file)) {
    const image = line.match(
      /^\s*FROM\s+(?:--platform=\S+\s+)?([^\s]+)(?:\s+AS\s+\S+)?\s*$/iu,
    )?.[1];
    return image ? [image] : [];
  }

  if (file.endsWith(".yml") || file.endsWith(".yaml")) {
    const key =
      file === "infra/gcp/cloud-build/cloudbuild.yaml"
        ? "(?:image|imageName|proxyImage|name)"
        : "(?:image|imageName|proxyImage)";
    const image = line.match(
      new RegExp(`^\\s*(?:-\\s*)?${key}:\\s*["']?([^\\s"'#]+)["']?`, "u"),
    )?.[1];
    if (!image || image.startsWith("{{")) return [];
    return [image];
  }

  if (IMAGE_LITERAL_FILES.has(file)) {
    const context = lines.slice(Math.max(0, index - 6), index + 1).join("\n");
    const relevant =
      (file === "apps/worker/src/activities/registry.ts" && /image\s*:/u.test(line)) ||
      (file === "apps/worker/src/env.ts" && /REGISTRY_GC_IMAGE/u.test(context)) ||
      (file === "apps/worker/src/services/k8s-netpol-probe.ts" &&
        /NETPOL_PROBE_IMAGE/u.test(context)) ||
      (file === "packages/db/prisma/seeds/problems.ts" && /imageRef\s*:/u.test(line));
    if (!relevant) return [];
    return Array.from(line.matchAll(/["']([^"']+)["']/gu), (match) => match[1]).filter(
      (value) => IMAGE_REFERENCE.test(value),
    );
  }

  return [];
}

export function checkSupplyChainFile(file, content) {
  const violations = [];
  const lines = content.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trimStart().startsWith("#")) continue;
    const lineNumber = index + 1;

    for (const image of imageReferences(file, line, index, lines)) {
      if (!IMMUTABLE_IMAGE.test(image)) {
        violations.push(
          violation(
            file,
            lineNumber,
            `runtime image must use a readable tag plus manifest digest: ${image}`,
          ),
        );
      }
    }

    const action = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/u)?.[1];
    if (action && !action.startsWith("./") && !ACTION_SHA.test(action)) {
      violations.push(
        violation(
          file,
          lineNumber,
          "non-local Actions uses must use a 40-character commit SHA",
        ),
      );
    }

    if (/\b(?:curl|wget|helm|kubectl)\b/u.test(line) && /\|\|\s*true\b/u.test(line)) {
      violations.push(
        violation(file, lineNumber, "supply-chain commands must not swallow errors"),
      );
    }
    if (/\bhelm\s+repo\s+(?:add|update)\b/u.test(line)) {
      violations.push(
        violation(
          file,
          lineNumber,
          "remote Helm repositories are forbidden; use verified local charts",
        ),
      );
    }
    if (/\bkubectl\b[^\n]*\bapply\b[^\n]*-f\s+https?:\/\//u.test(line)) {
      violations.push(
        violation(
          file,
          lineNumber,
          "remote kubectl apply is forbidden; verify a local artifact first",
        ),
      );
    }

    if (!/\b(?:curl|wget)\b/u.test(line)) continue;
    const { command, end } = logicalCommand(lines, index);
    const url = command.match(/https?:\/\/[^\s"']+/u)?.[0];
    if (!url) continue;

    if (/\|\s*(?:ba)?sh\b/u.test(command)) {
      violations.push(
        violation(file, lineNumber, "downloads must not pipe remote content to a shell"),
      );
    }
    if (!url.startsWith("https://")) {
      violations.push(violation(file, lineNumber, "downloads must use HTTPS"));
    }
    if (
      url.includes("$") ||
      /\/(?:main|master|latest)(?:\/|$)/u.test(url) ||
      !VERSIONED_URL.test(url)
    ) {
      violations.push(
        violation(file, lineNumber, "download URLs must contain a literal version or commit"),
      );
    }

    const verificationWindow = lines.slice(end + 1, end + 5).join("\n");
    if (
      !SHA256.test(verificationWindow) ||
      !/sha256sum\s+--check\b/u.test(verificationWindow)
    ) {
      violations.push(
        violation(file, lineNumber, "every download requires literal SHA-256 verification"),
      );
    }
    index = end;
  }

  return violations;
}

function policyFiles(root) {
  const files = [];
  for (const directory of [".github", "infra", "scripts"]) {
    const start = join(root, directory);
    if (!statSync(start, { throwIfNoEntry: false })?.isDirectory()) continue;
    const visit = (absolute) => {
      for (const entry of readdirSync(absolute, { withFileTypes: true })) {
        const path = join(absolute, entry.name);
        if (entry.isDirectory()) {
          visit(path);
        } else if (entry.isFile()) {
          const relativePath = relative(root, path);
          if (
            entry.name.endsWith(".sh") ||
            isDockerfile(relativePath) ||
            [".yml", ".yaml"].includes(extname(entry.name)) ||
            IMAGE_LITERAL_FILES.has(relativePath)
          ) {
            files.push(path);
          }
        }
      }
    };
    visit(start);
  }
  const compose = join(root, "docker-compose.yml");
  if (statSync(compose, { throwIfNoEntry: false })?.isFile()) files.push(compose);
  for (const relativePath of [
    ...IMAGE_LITERAL_FILES,
    "apps/web/src/lib/server/advanced-scaffold/files/run/Dockerfile",
    "apps/web/src/lib/server/advanced-scaffold/files/grade/Dockerfile",
    "apps/web/src/lib/server/advanced-scaffold/files/service/Dockerfile",
  ]) {
    const absolute = join(root, relativePath);
    if (statSync(absolute, { throwIfNoEntry: false })?.isFile()) files.push(absolute);
  }
  return files;
}

export function scanSupplyChainPolicy(root = process.cwd()) {
  return policyFiles(root).flatMap((absolute) =>
    checkSupplyChainFile(relative(root, absolute), readFileSync(absolute, "utf8")),
  );
}

function main() {
  const violations = scanSupplyChainPolicy();
  if (violations.length === 0) return;
  for (const { file, line, message } of violations) {
    console.error(`${file}:${line}: ${message}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
