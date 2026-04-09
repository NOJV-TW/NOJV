import * as fs from "node:fs/promises";

/** Return true iff `filePath` is accessible to the current process. */
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
