import { beforeEach, describe, expect, it, vi } from "vitest";

const { tokenFindById, tokenDelete, userFindByUsername, userUpdate } = vi.hoisted(() => ({
  tokenFindById: vi.fn(),
  tokenDelete: vi.fn(),
  userFindByUsername: vi.fn(),
  userUpdate: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  schoolVerificationTokenRepo: {
    findById: tokenFindById,
    delete: tokenDelete,
    create: vi.fn(),
  },
  userRepo: { findByUsername: userFindByUsername, update: userUpdate },
}));

import {
  peekSchoolVerification,
  processSchoolVerification,
} from "../../../packages/domain/src/user/verification";

beforeEach(() => {
  vi.clearAllMocks();
});

const future = new Date(Date.now() + 60_000);
const past = new Date(Date.now() - 60_000);
const liveToken = { token: "t", userId: "u1", username: "s123", expiresAt: future };

describe("peekSchoolVerification — validates without consuming (mail-scanner GET safety)", () => {
  it("returns valid for a live token WITHOUT updating the user or deleting the token", async () => {
    tokenFindById.mockResolvedValue(liveToken);
    userFindByUsername.mockResolvedValue(null);

    const result = await peekSchoolVerification("t");

    expect(result).toEqual({ status: "valid", username: "s123" });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(tokenDelete).not.toHaveBeenCalled();
  });

  it("errors on an expired token without any side effect", async () => {
    tokenFindById.mockResolvedValue({ ...liveToken, expiresAt: past });

    const result = await peekSchoolVerification("t");

    expect(result.status).toBe("error");
    expect(tokenDelete).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("errors when the username is already taken by another account", async () => {
    tokenFindById.mockResolvedValue(liveToken);
    userFindByUsername.mockResolvedValue({ id: "other" });

    const result = await peekSchoolVerification("t");

    expect(result.status).toBe("error");
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe("processSchoolVerification — consumes the token (POST action)", () => {
  it("sets the username and deletes the token", async () => {
    tokenFindById.mockResolvedValue(liveToken);
    userFindByUsername.mockResolvedValue(null);

    const result = await processSchoolVerification("t");

    expect(result).toEqual({ status: "success", username: "s123" });
    expect(userUpdate).toHaveBeenCalledWith("u1", {
      username: "s123",
      displayUsername: "s123",
    });
    expect(tokenDelete).toHaveBeenCalledWith("t");
  });
});
