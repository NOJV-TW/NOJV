import * as fs from "node:fs/promises";
import * as path from "node:path";
import picomatch from "picomatch";
import type { ArtifactConfig, ArtifactEntry } from "@nojv/core";

/**
 * Collect artifacts produced by the user's program.
 *
 * Scans the workspace directory for files matching the configured patterns
 * and copies them to the artifacts output directory.
 *
 * @param workDir     - The workspace directory where the user's program ran
 * @param artifactDir - The output directory to copy matching files into
 * @param config      - Artifact collection configuration
 * @returns List of collected artifact entries
 */
export async function collectArtifacts(
  workDir: string,
  artifactDir: string,
  config: ArtifactConfig
): Promise<ArtifactEntry[]> {
  await fs.mkdir(artifactDir, { recursive: true });

  const entries: ArtifactEntry[] = [];
  let totalSize = 0;

  for (const pattern of config.patterns) {
    const matches = await globMatch(workDir, pattern);

    for (const filePath of matches) {
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;

        // Enforce total size limit
        if (totalSize + stat.size > config.maxTotalSizeBytes) {
          break;
        }

        const relativePath = path.relative(workDir, filePath);

        // Security: prevent path traversal
        if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
          continue;
        }

        const destPath = path.join(artifactDir, relativePath);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(filePath, destPath);

        entries.push({
          path: relativePath,
          sizeBytes: stat.size
        });

        totalSize += stat.size;
      } catch {
        // Skip files that can't be read
      }
    }
  }

  return entries;
}

/**
 * Match files under `baseDir` against a glob pattern. Supports the standard
 * glob syntax via picomatch (`*`, `**`, `?`, `{a,b}`, `[abc]`, …).
 * Returns absolute paths of matching files.
 */
async function globMatch(baseDir: string, pattern: string): Promise<string[]> {
  // Fast path: literal file name (no wildcards / brace-expansion / char class)
  if (!/[*?{[]/.test(pattern)) {
    const fullPath = path.join(baseDir, pattern);
    try {
      return (await fs.stat(fullPath)).isFile() ? [fullPath] : [];
    } catch {
      return [];
    }
  }

  const match = picomatch(pattern);
  const results: string[] = [];
  await walkDir(baseDir, baseDir, match, results);
  return results;
}

/** Recursively walk a directory and collect files matching the matcher. */
async function walkDir(
  baseDir: string,
  currentDir: string,
  match: (path: string) => boolean,
  results: string[]
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(baseDir, fullPath, match, results);
    } else if (entry.isFile() && match(path.relative(baseDir, fullPath))) {
      results.push(fullPath);
    }
  }
}
