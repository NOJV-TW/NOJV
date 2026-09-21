import { describe, expect, it } from "vitest";
import { judgeQuota } from "../../../apps/worker/src/services/judge-quota";
import type { JudgePermit } from "../../../apps/worker/src/services/judge-capacity";
const Mi = 1024 * 1024;
function held(nodeName: string, cleanupConfirmed = false): JudgePermit {
  return {
    permitId: nodeName,
    nodeName,
    units: 1,
    resources: { cpuMillis: 2000, memoryBytes: 512 * Mi },
    cleanupConfirmed,
    request: {
      requestId: nodeName,
      runId: nodeName,
      studentId: nodeName,
      phase: "wave",
      resources: { cpuMillis: 2000, memoryBytes: 512 * Mi },
      maximumUnits: 1,
    },
  };
}
describe("judge quota safety during node changes", () => {
  it("retains failed-node commitments in addition to healthy-node capacity", () => {
    const quota = judgeQuota(
      {
        observedAt: 1,
        nodes: [
          {
            name: "healthy",
            eligible: true,
            allocatable: { cpuMillis: 8000, memoryBytes: 2048 * Mi },
            budget: { cpuMillis: 6000, memoryBytes: 1536 * Mi },
          },
          {
            name: "failed",
            eligible: false,
            allocatable: { cpuMillis: 8000, memoryBytes: 2048 * Mi },
            budget: { cpuMillis: 6000, memoryBytes: 1536 * Mi },
          },
        ],
      },
      [held("failed"), held("healthy")],
    );
    expect(quota).toEqual({ cpuMillis: 8000, memoryBytes: 2048 * Mi, pods: 8 });
  });
  it("does not erase vanished-node holds until cleanup confirms termination", () => {
    expect(judgeQuota({ observedAt: 1, nodes: [] }, [held("gone")])).toEqual({
      cpuMillis: 2000,
      memoryBytes: 512 * Mi,
      pods: 2,
    });
    expect(judgeQuota({ observedAt: 1, nodes: [] }, [held("gone", true)])).toEqual({
      cpuMillis: 0,
      memoryBytes: 0,
      pods: 0,
    });
  });
});
