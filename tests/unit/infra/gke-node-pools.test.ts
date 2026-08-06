import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("GKE sandbox node-pool bootstrap", () => {
  const script = readFileSync(join(repoRoot, "infra/gcp/scripts/create-node-pools.sh"), "utf8");
  const systemConfig = readFileSync(
    join(repoRoot, "infra/gcp/gke/sandbox-node-system-config.yaml"),
    "utf8",
  );

  it("keeps a bounded on-demand baseline and a bounded Spot burst", () => {
    expect(script).toContain("--total-min-nodes=1 --total-max-nodes=1");
    expect(script).toContain(
      '--total-min-nodes=0 --total-max-nodes="${SANDBOX_SPOT_MAX_NODES}"',
    );
    expect(script).toContain("--spot");
    expect(script).toContain("--image-type=cos_containerd");
    expect(script).toContain("--sandbox=type=gvisor");
    expect(script).toContain("--enable-image-streaming");
    expect(script).toContain('--system-config-from-file="${SANDBOX_SYSTEM_CONFIG}"');
    expect(systemConfig).toContain("podPidsLimit: 1024");
  });
});
