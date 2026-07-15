function tokenizeSql(sql) {
  const tokens = [];

  for (let index = 0; index < sql.length;) {
    const character = sql[index];
    const next = sql[index + 1];

    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }

    if (character === "-" && next === "-") {
      index = sql.indexOf("\n", index + 2);
      if (index === -1) break;
      continue;
    }

    if (character === "/" && next === "*") {
      const end = sql.indexOf("*/", index + 2);
      index = end === -1 ? sql.length : end + 2;
      continue;
    }

    if (character === "'") {
      index += 1;
      while (index < sql.length) {
        if (sql[index] !== "'") {
          index += 1;
          continue;
        }
        if (sql[index + 1] === "'") {
          index += 2;
          continue;
        }
        index += 1;
        break;
      }
      continue;
    }

    if (character === "$") {
      const tag = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u)?.[0];
      if (tag) {
        const end = sql.indexOf(tag, index + tag.length);
        index = end === -1 ? sql.length : end + tag.length;
        continue;
      }
    }

    if (character === '"') {
      let value = "";
      index += 1;
      while (index < sql.length) {
        if (sql[index] !== '"') {
          value += sql[index];
          index += 1;
          continue;
        }
        if (sql[index + 1] === '"') {
          value += '"';
          index += 2;
          continue;
        }
        index += 1;
        break;
      }
      tokens.push({ kind: "identifier", value });
      continue;
    }

    const word = sql.slice(index).match(/^[A-Za-z_][A-Za-z0-9_$]*/u)?.[0];
    if (word) {
      tokens.push({ kind: "word", value: word });
      index += word.length;
      continue;
    }

    tokens.push({ kind: "symbol", value: character });
    index += 1;
  }

  return tokens;
}

function isKeyword(token, keyword) {
  return token?.kind === "word" && token.value.toUpperCase() === keyword;
}

function readRelation(tokens, start) {
  const parts = [];
  let index = start;

  while (tokens[index]?.kind === "word" || tokens[index]?.kind === "identifier") {
    const token = tokens[index];
    parts.push(token.kind === "word" ? token.value.toLowerCase() : token.value);
    index += 1;
    if (tokens[index]?.value !== ".") break;
    index += 1;
  }

  if (parts.length === 0 || parts.length > 2) return null;
  if (parts.length === 1) parts.unshift("public");
  return { name: parts.join("."), next: index };
}

function skipIfNotExists(tokens, start) {
  if (
    isKeyword(tokens[start], "IF") &&
    isKeyword(tokens[start + 1], "NOT") &&
    isKeyword(tokens[start + 2], "EXISTS")
  ) {
    return start + 3;
  }
  return start;
}

export function findBlockingIndexRelations(sql) {
  const tokens = tokenizeSql(sql);
  const createdRelations = new Set();
  const indexes = [];

  for (let index = 0; index < tokens.length; index += 1) {
    if (!isKeyword(tokens[index], "CREATE")) continue;

    let cursor = index + 1;
    if (isKeyword(tokens[cursor], "TABLE")) {
      cursor = skipIfNotExists(tokens, cursor + 1);
      const relation = readRelation(tokens, cursor);
      if (relation) createdRelations.add(relation.name);
      continue;
    }

    if (isKeyword(tokens[cursor], "UNIQUE")) cursor += 1;
    if (!isKeyword(tokens[cursor], "INDEX")) continue;
    cursor += 1;

    const concurrent = isKeyword(tokens[cursor], "CONCURRENTLY");
    if (concurrent) cursor += 1;
    cursor = skipIfNotExists(tokens, cursor);

    const indexName = readRelation(tokens, cursor);
    if (!indexName) continue;
    cursor = indexName.next;
    if (!isKeyword(tokens[cursor], "ON")) continue;
    cursor += 1;
    if (isKeyword(tokens[cursor], "ONLY")) cursor += 1;

    const relation = readRelation(tokens, cursor);
    if (relation) indexes.push({ concurrent, relation: relation.name });
  }

  return indexes
    .filter(({ concurrent, relation }) => !concurrent && !createdRelations.has(relation))
    .map(({ relation }) => relation);
}
