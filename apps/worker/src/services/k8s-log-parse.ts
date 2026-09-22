const RUNNER_LOG_PREFIX = "[sandbox-runner]";

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function reassemble(lines: string[], start: number): unknown {
  let joined = lines[start] ?? "";
  for (let j = start + 1; j < lines.length; j++) {
    const line = lines[j] ?? "";
    const trimmed = line.trim();
    if (
      trimmed.startsWith(RUNNER_LOG_PREFIX) ||
      (trimmed.startsWith("{") && tryParse(trimmed) !== undefined)
    )
      continue;
    joined += line;
    const [parsed] = parseDocuments(joined);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function parseDocuments(text: string): unknown[] {
  const whole = tryParse(text);
  if (whole !== undefined) return [whole];
  const documents: unknown[] = [];
  let start = 0;
  for (let at = text.indexOf("}{"); at !== -1; at = text.indexOf("}{", at + 1)) {
    const document = tryParse(text.slice(start, at + 1));
    if (document === undefined) continue;
    documents.push(document);
    start = at + 1;
  }
  const rest = start > 0 ? tryParse(text.slice(start)) : undefined;
  if (rest !== undefined) documents.push(rest);
  return documents;
}

export function scanJsonLinesFromEnd<T>(
  logs: string,
  match: (parsed: unknown) => T | null,
): T | null {
  const lines = logs.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]?.trim();
    if (!trimmed?.startsWith("{")) continue;
    const documents = parseDocuments(trimmed);
    if (documents.length === 0) {
      const reassembled = reassemble(lines, i);
      if (reassembled !== undefined) documents.push(reassembled);
    }
    for (const document of documents.reverse()) {
      const result = match(document);
      if (result !== null) return result;
    }
  }
  return null;
}
