#!/usr/bin/env node
// Generate a field-level Markdown reference from the Prisma schema.
//
// The schema is split across packages/db/prisma/schema/*.prisma; this
// walks every file, extracts each model + enum, and emits
// docs/architecture/DATABASE.generated.md. Run via `pnpm db:docs`.
//
// Dependency-free on purpose: Prisma model/enum bodies never nest braces
// (attributes use parens), so a line-based parser is enough and avoids
// pulling in a schema-parser package.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaDir = join(repoRoot, "packages/db/prisma/schema");
const outPath = join(repoRoot, "docs/architecture/DATABASE.generated.md");

/** Strip a trailing `// ...` line comment. */
function stripComment(line) {
  return line.replace(/\s+\/\/.*$/, "").trimEnd();
}

function parseModelBody(body) {
  const fields = [];
  const blockAttrs = [];
  for (const raw of body) {
    const line = raw.trim();
    if (line === "" || line.startsWith("//")) continue;
    if (line.startsWith("@@")) {
      blockAttrs.push(stripComment(line));
      continue;
    }
    const parts = stripComment(line).split(/\s+/);
    if (parts.length < 2) continue;
    fields.push({ name: parts[0], type: parts[1], attrs: parts.slice(2).join(" ") });
  }
  return { fields, blockAttrs };
}

function parseEnumBody(body) {
  const values = [];
  for (const raw of body) {
    const line = stripComment(raw.trim());
    if (line === "" || line.startsWith("//")) continue;
    const value = line.split(/\s+/)[0];
    if (value) values.push(value);
  }
  return values;
}

function parseSchema(text) {
  const lines = text.split("\n");
  const models = [];
  const enums = [];
  let pendingDoc = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") {
      pendingDoc = [];
      continue;
    }
    if (line.startsWith("///")) {
      pendingDoc.push(line.slice(3).trim());
      continue;
    }
    if (line.startsWith("//")) {
      pendingDoc = [];
      continue;
    }

    const block = line.match(/^(model|enum|generator|datasource)\s+(\w+)\s*\{/);
    if (block) {
      const [, kind, name] = block;
      const body = [];
      i++;
      while (i < lines.length && lines[i].trim() !== "}") {
        body.push(lines[i]);
        i++;
      }
      const doc = pendingDoc.join(" ");
      if (kind === "model") models.push({ name, doc, ...parseModelBody(body) });
      else if (kind === "enum") enums.push({ name, doc, values: parseEnumBody(body) });
      pendingDoc = [];
      continue;
    }
    pendingDoc = [];
  }

  return { models, enums };
}

function renderFile(fileName, { models, enums }) {
  const out = [`## \`${fileName}\``, ""];

  if (enums.length > 0) {
    out.push("### Enums", "");
    for (const e of enums.sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(`#### \`${e.name}\``, "");
      if (e.doc) out.push(e.doc, "");
      out.push(e.values.map((v) => `\`${v}\``).join(" · "), "");
    }
  }

  if (models.length > 0) {
    out.push("### Models", "");
    for (const m of models.sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(`#### \`${m.name}\``, "");
      if (m.doc) out.push(m.doc, "");
      out.push("| Field | Type | Attributes |", "| ----- | ---- | ---------- |");
      for (const f of m.fields) {
        out.push(`| \`${f.name}\` | \`${f.type}\` | ${f.attrs ? `\`${f.attrs}\`` : "—"} |`);
      }
      out.push("");
      if (m.blockAttrs.length > 0) {
        out.push(
          `Indexes & constraints: ${m.blockAttrs.map((a) => `\`${a}\``).join(", ")}`,
          "",
        );
      }
    }
  }

  return out.join("\n");
}

async function main() {
  const files = (await readdir(schemaDir)).filter((f) => f.endsWith(".prisma")).sort();
  if (files.length === 0) {
    console.error(`No .prisma files found in ${schemaDir}`);
    process.exit(1);
  }

  const sections = [];
  let modelCount = 0;
  let enumCount = 0;
  for (const file of files) {
    const parsed = parseSchema(await readFile(join(schemaDir, file), "utf8"));
    if (parsed.models.length === 0 && parsed.enums.length === 0) continue;
    modelCount += parsed.models.length;
    enumCount += parsed.enums.length;
    sections.push(renderFile(file, parsed));
  }

  const header = [
    "# Database Schema Reference (generated)",
    "",
    "<!-- GENERATED FILE — do not edit. Run `pnpm db:docs` to regenerate. -->",
    "",
    "> Auto-generated from `packages/db/prisma/schema/*.prisma` by",
    "> `scripts/generate-schema-docs.mjs`. The curated prose overview lives",
    "> in [DATABASE.md](./DATABASE.md); this file is the exhaustive",
    "> field-level reference.",
    "",
    `_${modelCount} models and ${enumCount} enums across ${sections.length} schema files._`,
    "",
  ].join("\n");

  await writeFile(outPath, `${header}\n${sections.join("\n")}\n`, "utf8");
  console.log(`Wrote ${outPath} — ${modelCount} models, ${enumCount} enums`);
}

await main();
