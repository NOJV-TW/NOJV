import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fluxRunbook = readFileSync(join(repoRoot, "infra/flux/README.md"), "utf8");
const incidentRunbook = readFileSync(
  join(repoRoot, "docs/runbooks/incident-recovery.md"),
  "utf8",
);

describe("forward-only production recovery guidance", () => {
  it("never instructs operators to force an arbitrary retained deploy tag", () => {
    expect(fluxRunbook).not.toContain(
      "git push --force origin refs/tags/nojv-deploy-<image-tag>:refs/heads/deploy",
    );
    expect(fluxRunbook).toContain("nojv.tw/schema-contract: versioned-storage-v1");
    expect(fluxRunbook).toContain("forward fix");
    expect(fluxRunbook).toContain(
      '"--force-with-lease=refs/heads/deploy:${current_deploy_tip}"',
    );
    expect(fluxRunbook).not.toContain("<current-deploy-tip>");
  });

  it("does not prescribe an unconditional Helm rollback for a wedged release", () => {
    expect(incidentRunbook).not.toContain(
      "`helm rollback` to the last-known-good revision to unstick it",
    );
    expect(incidentRunbook).toContain("nojv.tw/schema-contract: versioned-storage-v1");
    expect(incidentRunbook).toContain("forward fix");
    expect(incidentRunbook).toContain("keep workloads in maintenance");
  });
});
