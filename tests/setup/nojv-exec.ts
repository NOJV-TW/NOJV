import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export default function buildNojvExec() {
  const source = fileURLToPath(
    new URL("../../apps/sandbox-runner/native/nojv-exec.c", import.meta.url),
  );
  const hash = createHash("sha256").update(readFileSync(source)).digest("hex").slice(0, 16);
  const binary = join(tmpdir(), `nojv-exec-${hash}`);
  if (!existsSync(binary)) {
    const partial = `${binary}.${String(process.pid)}`;
    execFileSync("cc", ["-O2", "-Wall", "-Wextra", "-Werror", "-o", partial, source]);
    renameSync(partial, binary);
  }
  process.env.NOJV_EXEC_PATH = binary;
}
