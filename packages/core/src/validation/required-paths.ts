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
