import type { SubmissionSource } from "@nojv/domain";

export function flattenSourcesForDisplay(files: SubmissionSource[]): string {
  if (files.length === 0) return "";
  const first = files[0];
  if (files.length === 1 && first) return first.content;
  return files.map((f) => `// ===== ${f.path} =====\n${f.content}`).join("\n\n");
}
