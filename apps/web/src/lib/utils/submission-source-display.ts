import type { SubmissionSource } from "@nojv/domain";

/**
 * Flatten a multi-file submission into a single Monaco buffer for the
 * legacy single-pane viewer. Each file gets a `// ===== path =====`
 * header. Single-file submissions return their content untouched.
 *
 * TODO(W4.A): replaced by a real per-file picker in the redesigned
 * source viewer. Delete this util when W4.A lands.
 */
export function flattenSourcesForDisplay(files: SubmissionSource[]): string {
  if (files.length === 0) return "";
  const first = files[0];
  if (files.length === 1 && first) return first.content;
  return files.map((f) => `// ===== ${f.path} =====\n${f.content}`).join("\n\n");
}
