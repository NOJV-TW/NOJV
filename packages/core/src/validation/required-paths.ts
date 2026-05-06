export type RequiredPathError =
  | { kind: "missing_file"; path: string }
  | { kind: "missing_folder"; path: string };

export interface RequiredPathsResult {
  ok: boolean;
  errors: RequiredPathError[];
}

export function validateRequiredPaths(
  uploadedPaths: readonly string[],
  requiredPaths: readonly string[],
): RequiredPathsResult {
  const errors: RequiredPathError[] = [];
  for (const req of requiredPaths) {
    if (req.endsWith("/")) {
      // Folder requirement: must contain at least one real file.
      // Zip directory markers (e.g. "src/" with no children) do NOT satisfy —
      // the matching upload path must be strictly longer than the prefix.
      if (!uploadedPaths.some((p) => p.startsWith(req) && p.length > req.length)) {
        errors.push({ kind: "missing_folder", path: req });
      }
    } else {
      if (!uploadedPaths.includes(req)) {
        errors.push({ kind: "missing_file", path: req });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
