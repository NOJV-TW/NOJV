export function scanJsonLinesFromEnd<T>(
  logs: string,
  match: (parsed: unknown) => T | null,
): T | null {
  const lines = logs.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]?.trim();
    if (!trimmed?.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const result = match(parsed);
    if (result !== null) return result;
  }
  return null;
}
