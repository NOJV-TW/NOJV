import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u;
const MUTABLE_TAGS = new Set(["latest", "main", "master", "local"]);
const COMPONENTS = ["web", "worker", "sandbox", "migrator"];

export function updateDeployImageValues(content, { tag, digests }) {
  if (!TAG.test(tag) || MUTABLE_TAGS.has(tag)) {
    throw new Error("IMAGE_TAG must be an explicit immutable release tag");
  }
  for (const component of COMPONENTS) {
    if (!DIGEST.test(digests[component] ?? "")) {
      throw new Error(`${component} digest must be sha256:<64 lowercase hex characters>`);
    }
  }

  let inImage = false;
  let inDigests = false;
  let tagCount = 0;
  const digestCounts = Object.fromEntries(COMPONENTS.map((component) => [component, 0]));

  const updated = content
    .split("\n")
    .map((line) => {
      if (line === "image:") {
        inImage = true;
        inDigests = false;
        return line;
      }
      if (inImage && /^\S/u.test(line)) {
        inImage = false;
        inDigests = false;
      }
      if (!inImage) return line;

      if (/^  tag:/u.test(line)) {
        tagCount += 1;
        return `  tag: ${tag}`;
      }
      if (line === "  digests:") {
        inDigests = true;
        return line;
      }
      if (inDigests && !/^    /u.test(line)) inDigests = false;
      if (!inDigests) return line;

      const component = line.match(/^    ([a-z]+):/u)?.[1];
      if (!component || !COMPONENTS.includes(component)) return line;
      digestCounts[component] += 1;
      return `    ${component}: ${digests[component]}`;
    })
    .join("\n");

  if (tagCount !== 1) {
    throw new Error(`Expected exactly one image.tag, found ${tagCount}`);
  }
  for (const component of COMPONENTS) {
    if (digestCounts[component] !== 1) {
      throw new Error(
        `Expected exactly one image.digests.${component}, found ${digestCounts[component]}`,
      );
    }
  }
  return updated;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function main() {
  const valuesFile = process.argv[2];
  if (!valuesFile) throw new Error("values file path is required");
  const digests = Object.fromEntries(
    COMPONENTS.map((component) => [
      component,
      requiredEnvironment(`IMAGE_DIGEST_${component.toUpperCase()}`),
    ]),
  );
  const updated = updateDeployImageValues(readFileSync(valuesFile, "utf8"), {
    tag: requiredEnvironment("IMAGE_TAG"),
    digests,
  });
  writeFileSync(valuesFile, updated);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
