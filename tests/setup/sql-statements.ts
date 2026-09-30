export function splitStatements(sql: string): string[] {
  const source = sql.replace(/^\s*--.*$/gm, "");
  const statements: string[] = [];
  let start = 0;
  let dollarTag: string | null = null;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < source.length; index += 1) {
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }

    const character = source[index];
    if (inSingleQuote) {
      if (character === "'" && source[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        inSingleQuote = false;
      }
      continue;
    }
    if (inDoubleQuote) {
      if (character === '"' && source[index + 1] === '"') {
        index += 1;
      } else if (character === '"') {
        inDoubleQuote = false;
      }
      continue;
    }
    if (character === "'") {
      inSingleQuote = true;
      continue;
    }
    if (character === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (character === "$") {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(source.slice(index))?.[0];
      if (tag) {
        dollarTag = tag;
        index += tag.length - 1;
        continue;
      }
    }
    if (character === ";") {
      const statement = source.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }

  const tail = source.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}
