import { execFile } from "node:child_process";

const SANDBOX_IMAGE = "nojv-sandbox:local";

function run(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10_000 }, (err, stdout) => {
      resolve({ ok: !err, stdout: stdout.toString() });
    });
  });
}

export async function dockerImageAvailable(): Promise<boolean> {
  if (!(await run("docker", ["info"])).ok) return false;
  const { ok, stdout } = await run("docker", ["images", "-q", SANDBOX_IMAGE]);
  return ok && stdout.trim().length > 0;
}

export async function requireSandboxImage(ctx: { skip: () => void }): Promise<boolean> {
  if (await dockerImageAvailable()) return true;
  if (process.env.REQUIRE_SANDBOX_IMAGE === "1") {
    throw new Error(
      "nojv-sandbox:local image missing while REQUIRE_SANDBOX_IMAGE=1 — run `pnpm sandbox:build` before the isolation suite (these exploit tests must not silently skip in nightly).",
    );
  }
  ctx.skip();
  return false;
}
