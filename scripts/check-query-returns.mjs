#!/usr/bin/env node
import { globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const pattern = "packages/application/src/**/*.ts";
const queryName = /^(get|load|fetch|require)[A-Z]/;
const escapeHatch = "intentional-nullable";

function isNullExpression(expression) {
  while (expression && ts.isParenthesizedExpression(expression)) {
    expression = expression.expression;
  }
  return expression?.kind === ts.SyntaxKind.NullKeyword;
}

function hasNullReturn(body) {
  let found = false;
  const visit = (node) => {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && isNullExpression(node.expression)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

function hasEscapeHatch(source, sourceFile, node) {
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
  return line > 0 && source.split(/\r?\n/)[line - 1]?.includes(escapeHatch);
}

function check(file) {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations = [];

  for (const node of sourceFile.statements) {
    if (
      !ts.isFunctionDeclaration(node) ||
      !node.body ||
      !node.name ||
      !queryName.test(node.name.text) ||
      !node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword) ||
      !hasNullReturn(node.body) ||
      hasEscapeHatch(source, sourceFile, node)
    ) {
      continue;
    }
    violations.push(node.name.text);
  }

  return violations;
}

const files = globSync(pattern, { cwd: repoRoot }).map((path) => resolve(repoRoot, path));
let failed = false;
for (const file of files) {
  for (const name of check(file)) {
    failed = true;
    const relativePath = file.slice(repoRoot.length + 1);
    console.error(
      `${relativePath}: ${name} returns null. Throw NotFoundError instead, ` +
        `or add a leading \`// ${escapeHatch}: <why>\` comment.`,
    );
  }
}

if (failed) {
  console.error("");
  console.error(
    "See docs/architecture/DESIGN.md 'Domain error handling' for the full convention.",
  );
  process.exit(1);
}

console.log(
  `check-query-returns: scanned ${String(files.length)} application source file(s); no violations.`,
);
