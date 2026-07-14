import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ACTION_SHA = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[a-f0-9]{40}$/u;
const VERSIONED_URL = /(?:^|[/_.@-])v?\d+\.\d+\.\d+(?:[/_.-]|$)|[0-9a-f]{40}/u;
const SHA256 = /[a-f0-9]{64}/u;
const IMMUTABLE_IMAGE =
  /^(?:[a-z0-9.-]+(?::[0-9]+)?\/)?(?:[a-z0-9._-]+\/)*[a-z0-9._-]+:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}@sha256:[a-f0-9]{64}$/u;
const IMAGE_REFERENCE =
  /^(?:[a-z0-9.-]+(?::[0-9]+)?\/)?(?:[a-z0-9._-]+\/)*[a-z0-9._-]+:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}(?:@sha256:[a-f0-9]{64})?$/u;
const LOCAL_IMAGE =
  /^(?:(?:[a-z0-9.-]+(?::[0-9]+)?\/)?(?:[a-z0-9._-]+\/)*[a-z0-9._-]+:local|nojv-[a-z0-9._-]+:pr)$/u;
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".sh", ".ts"]);
const SKIPPED_DIRECTORIES = new Set([
  ".svelte-kit",
  "build",
  "dist",
  "generated",
  "node_modules",
  "paraglide",
]);

function isImmutableRemoteModule(module) {
  try {
    const url = new URL(module);
    return (
      url.protocol === "https:" &&
      !module.includes("$") &&
      !/(?:@|\/)(?:main|master|latest)(?:\/|$)/iu.test(url.pathname) &&
      VERSIONED_URL.test(url.pathname)
    );
  } catch {
    return false;
  }
}

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

function literalImageReferences(content) {
  return Array.from(content.matchAll(/["']([^"']+)["']/gu), (match) => match[1]).filter(
    (value) => IMAGE_REFERENCE.test(value) && !/^\d+:\d+$/u.test(value),
  );
}

function commandImageReferences(command) {
  const references = new Set(literalImageReferences(command));
  for (const token of command.split(/\s+/u)) {
    const value = token.replace(/^["'(`]+|[\\;),"'`]+$/gu, "");
    if (IMAGE_REFERENCE.test(value) && !/^\d+:\d+$/u.test(value)) references.add(value);
  }
  return references;
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

  if (SOURCE_EXTENSIONS.has(extname(file)) && !file.endsWith(".sh")) {
    const context = lines.slice(Math.max(0, index - 8), index + 1).join("\n");
    if (!/(?:docker|image(?:Name|Ref)?)/iu.test(context)) return [];
    return literalImageReferences(line);
  }

  return [];
}

export function checkSupplyChainFile(file, content) {
  const violations = [];
  const lines = content.split("\n");

  if (file.endsWith(".json")) {
    let document;
    try {
      document = JSON.parse(content);
    } catch {
      document = undefined;
    }
    if (Array.isArray(document?.modules)) {
      for (const module of document.modules) {
        if (typeof module !== "string" || !/^https?:\/\//u.test(module)) continue;
        const line = lines.findIndex((candidate) => candidate.includes(module)) + 1;
        if (!isImmutableRemoteModule(module)) {
          violations.push(
            violation(
              file,
              line,
              "remote executable modules must use HTTPS and an immutable version or commit",
            ),
          );
        }
      }
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trimStart().startsWith("#")) continue;
    const lineNumber = index + 1;

    const references = new Set(imageReferences(file, line, index, lines));
    if (/\bdocker\s+(?:create|pull|run)\b/u.test(line)) {
      const { command } = logicalCommand(lines, index);
      for (const image of commandImageReferences(command)) references.add(image);
    }

    for (const image of references) {
      if (!IMMUTABLE_IMAGE.test(image) && !LOCAL_IMAGE.test(image)) {
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
  const files = new Set();
  for (const directory of [".github", "apps", "infra", "packages", "scripts"]) {
    const start = join(root, directory);
    if (!statSync(start, { throwIfNoEntry: false })?.isDirectory()) continue;
    const visit = (absolute) => {
      for (const entry of readdirSync(absolute, { withFileTypes: true })) {
        if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
        const path = join(absolute, entry.name);
        if (entry.isDirectory()) {
          visit(path);
        } else if (entry.isFile()) {
          const relativePath = relative(root, path);
          if (
            entry.name.endsWith(".sh") ||
            isDockerfile(relativePath) ||
            [".json", ".yml", ".yaml"].includes(extname(entry.name)) ||
            SOURCE_EXTENSIONS.has(extname(entry.name))
          ) {
            files.add(path);
          }
        }
      }
    };
    visit(start);
  }
  const compose = join(root, "docker-compose.yml");
  if (statSync(compose, { throwIfNoEntry: false })?.isFile()) files.add(compose);
  return [...files];
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
