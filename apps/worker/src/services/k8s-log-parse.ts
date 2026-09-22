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
    const parsed = tryParse(joined);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function scanJsonLinesFromEnd<T>(
  logs: string,
  match: (parsed: unknown) => T | null,
): T | null {
  const lines = logs.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]?.trim();
    if (!trimmed?.startsWith("{")) continue;
    const parsed = tryParse(trimmed) ?? reassemble(lines, i);
    if (parsed === undefined) continue;
    const result = match(parsed);
    if (result !== null) return result;
  }
  return null;
}
