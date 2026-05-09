export interface ParsedCase {
  input: string;
  output: string;
  sourceFile: string;
}

export interface SubtaskConfig {
  name: string;
  description: string;
  points: number;
  caseIndices: number[];
}

export function detectSubtasksFromFiles(
  files: { name: string; content: string }[],
  regexPattern: string,
  inExt: string,
  outExt: string,
): { cases: ParsedCase[]; subtasks: SubtaskConfig[]; error?: string } {
  let regex: RegExp;
  try {
    regex = new RegExp(`^${regexPattern}$`);
  } catch {
    return { cases: [], subtasks: [], error: "invalid_regex" };
  }

  const bySubtask = new Map<
    string,
    Map<string, { in?: string; out?: string; fileName: string }>
  >();

  for (const file of files) {
    const baseName = file.name.includes("/")
      ? (file.name.split("/").pop() ?? file.name)
      : file.name;
    const isIn = baseName.endsWith(inExt);
    const isOut = baseName.endsWith(outExt);
    if (!isIn && !isOut) continue;

    const ext = isIn ? inExt : outExt;
    const stem = baseName.slice(0, -ext.length);
    const match = regex.exec(stem);
    if (!match?.[1] || !match[2]) continue;

    const subtaskId = match[1];
    const caseId = match[2];

    if (!bySubtask.has(subtaskId)) {
      bySubtask.set(subtaskId, new Map());
    }
    const cases = bySubtask.get(subtaskId);
    if (!cases) continue;
    if (!cases.has(caseId)) {
      cases.set(caseId, { fileName: stem });
    }
    const entry = cases.get(caseId);
    if (!entry) continue;
    if (isIn) entry.in = file.content;
    if (isOut) entry.out = file.content;
  }

  if (bySubtask.size === 0) {
    return { cases: [], subtasks: [], error: "no_files_matched" };
  }

  const allCases: ParsedCase[] = [];
  const subtasks: SubtaskConfig[] = [];
  const sortedSubtaskIds = [...bySubtask.keys()].sort((a, b) => Number(a) - Number(b));

  for (const subtaskId of sortedSubtaskIds) {
    const casesMap = bySubtask.get(subtaskId);
    if (!casesMap) continue;
    const sortedCaseIds = [...casesMap.keys()].sort((a, b) => Number(a) - Number(b));
    const indices: number[] = [];

    for (const caseId of sortedCaseIds) {
      const entry = casesMap.get(caseId);
      if (!entry) continue;
      indices.push(allCases.length);
      allCases.push({
        input: entry.in ?? "",
        output: entry.out ?? "",
        sourceFile: `${entry.fileName}${inExt}`,
      });
    }

    subtasks.push({
      name: `Subtask ${subtaskId}`,
      description: "",
      points: Math.round(100 / sortedSubtaskIds.length),
      caseIndices: indices,
    });
  }

  return { cases: allCases, subtasks };
}
