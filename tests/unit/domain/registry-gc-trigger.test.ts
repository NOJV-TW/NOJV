import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ForbiddenError,
  registryDomain,
  configureDomainOrchestration,
} from "@nojv/application";

const dispatchRegistryGarbageCollect = vi.fn(async () => ({
  workflowId: "registry-gc",
  alreadyRunning: false,
}));

beforeEach(() => {
  vi.clearAllMocks();
  configureDomainOrchestration({
    cancelAssignmentDueSoon: vi.fn(async () => {}),
    cancelContestLifecycle: vi.fn(async () => {}),
    cancelExamAutoClose: vi.fn(async () => {}),
    cancelRejudge: vi.fn(async () => {}),
    describeSubmissionJudge: vi.fn(async () => null),
    dispatchPlagiarismCheck: vi.fn(async () => {}),
    dispatchRegistryGarbageCollect,
    dispatchRejudge: vi.fn(async () => ({ workflowId: "rejudge-test" })),
    dispatchSubmissionJudge: vi.fn(async () => {}),
    ensureAssignmentDueSoon: vi.fn(async () => {}),
    ensureContestLifecycle: vi.fn(async () => {}),
    ensureExamAutoClose: vi.fn(async () => {}),
    getRejudgeTriggeredBy: vi.fn(async () => null),
    probeTemporal: vi.fn(async () => {}),
    queryRejudgeProgress: vi.fn(async () => ({ completed: 0, total: 0 })),
    replaceAssignmentDueSoon: vi.fn(async () => {}),
    replaceContestLifecycle: vi.fn(async () => {}),
    replaceExamAutoClose: vi.fn(async () => {}),
    terminateSubmissionJudge: vi.fn(async () => {}),
  });
});

describe("triggerRegistryGarbageCollect", () => {
  it("dispatches for an admin and returns the workflow flag", async () => {
    const result = await registryDomain.triggerRegistryGarbageCollect({
      userId: "usr_admin",
      platformRole: "admin",
    });

    expect(result).toEqual({ workflowId: "registry-gc", alreadyRunning: false });
    expect(dispatchRegistryGarbageCollect).toHaveBeenCalledWith({
      triggeredByUserId: "usr_admin",
    });
  });

  it("passes the already-running flag through to the caller", async () => {
    dispatchRegistryGarbageCollect.mockResolvedValueOnce({
      workflowId: "registry-gc",
      alreadyRunning: true,
    });

    const result = await registryDomain.triggerRegistryGarbageCollect({
      userId: "usr_admin",
      platformRole: "admin",
    });

    expect(result.alreadyRunning).toBe(true);
  });

  it.each(["teacher", "student"] as const)("rejects non-admin actor: %s", async (role) => {
    await expect(
      registryDomain.triggerRegistryGarbageCollect({ userId: "usr_x", platformRole: role }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(dispatchRegistryGarbageCollect).not.toHaveBeenCalled();
  });
});
