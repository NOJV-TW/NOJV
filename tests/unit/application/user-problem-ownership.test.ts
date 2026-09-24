import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  findUser: vi.fn(),
  problemCount: vi.fn(),
  blockers: vi.fn(),
  anonymize: vi.fn(),
  deleteUser: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("@nojv/db", () => ({
  runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ $queryRaw: h.lock, problem: { count: h.problemCount } }),
  userRepo: {
    withTx: () => ({
      findById: h.findUser,
      countDeletionBlockers: h.blockers,
      anonymizeAndDisable: h.anonymize,
      delete: h.deleteUser,
    }),
  },
}));
vi.mock("../../../packages/application/src/course/roster", () => ({
  lockRosterIdentity: vi.fn(),
  bindPendingMemberships: vi.fn(),
}));
import { deleteUser } from "../../../packages/application/src/user/mutations";

beforeEach(() => {
  vi.clearAllMocks();
  h.findUser.mockResolvedValue({
    id: "owner",
    name: "Owner",
    platformRole: "student",
    isSuperAdmin: false,
  });
  h.problemCount.mockResolvedValue(1);
  h.blockers.mockResolvedValue(0);
});
describe("account deletion preserves problem ownership", () => {
  it.each([false, true])(
    "refuses before anonymizing or deleting an owner (superadmin=%s)",
    async (superadmin) => {
      await expect(deleteUser(superadmin, "owner")).rejects.toThrow(/Transfer ownership/);
      expect(h.blockers).not.toHaveBeenCalled();
      expect(h.anonymize).not.toHaveBeenCalled();
      expect(h.deleteUser).not.toHaveBeenCalled();
      expect(h.lock.mock.invocationCallOrder[0]).toBeLessThan(
        h.problemCount.mock.invocationCallOrder[0],
      );
    },
  );
  it.each([0, 1])(
    "retains existing deletion behavior when the user owns no problem (other blockers=%s)",
    async (blockers) => {
      h.problemCount.mockResolvedValue(0);
      h.blockers.mockResolvedValue(blockers);
      await expect(deleteUser(false, "owner")).resolves.toEqual({
        mode: blockers ? "soft" : "hard",
        name: "Owner",
      });
    },
  );
});
