import { normalizeRelativePath, sourceFileNames, type SandboxRequest } from "@nojv/core";

export interface ResolvedSourceFile {
  path: string;
  content: string;
}

export function resolveSourceFiles(
  request: SandboxRequest,
  options?: { requireSourceCode?: boolean },
): ResolvedSourceFile[] {
  const mainSourceName = sourceFileNames[request.language];
  const files: ResolvedSourceFile[] = [];
  let wroteMain = false;

  for (const sf of request.sourceFiles ?? []) {
    const normalized = normalizeRelativePath(sf.path);
    if (normalized === mainSourceName) wroteMain = true;
    files.push({ path: normalized, content: sf.content });
  }

  if (!wroteMain) {
    const shouldFallback = options?.requireSourceCode ? Boolean(request.sourceCode) : true;
    if (shouldFallback) {
      files.push({ path: mainSourceName, content: request.sourceCode });
    }
  }

  return files;
}
