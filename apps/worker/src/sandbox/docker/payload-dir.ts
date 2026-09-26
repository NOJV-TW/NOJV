import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { StagePayload } from "../shared/stage-payload";

export async function writePayloadDir(dir: string, payload: StagePayload): Promise<void> {
  await Promise.all(
    Object.entries(payload).map(([file, content]) =>
      writeFile(join(dir, file), content, "utf8"),
    ),
  );
  await chmod(dir, 0o755);
}
