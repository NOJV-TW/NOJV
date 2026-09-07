import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractStudentId, isCanonicalSchoolUsername, parseSchoolEmail } from "@nojv/core";

const { tokenFindById, tokenDelete, userFindByUsername, userUpdate, runTransaction } =
  vi.hoisted(() => ({
    tokenFindById: vi.fn(),
    tokenDelete: vi.fn(),
    userFindByUsername: vi.fn(),
    userUpdate: vi.fn(),
    runTransaction: vi.fn(),
  }));

vi.mock("@nojv/db", () => ({
  schoolVerificationTokenRepo: { findById: tokenFindById, delete: tokenDelete },
  userRepo: { findByUsername: userFindByUsername, update: userUpdate },
  runTransaction,
}));

import {
  initiateSchoolVerification,
  peekSchoolVerification,
} from "../../../packages/application/src/user/verification";

beforeEach(() => vi.resetAllMocks());

const liveToken = {
  token: "token-1",
  userId: "user-1",
  username: "ntu_b11902001",
  expiresAt: new Date("2100-01-01T00:00:00Z"),
};

describe("canonical school identities", () => {
  it.each([
    ["41047001A@ntnu.edu.tw", "41047001a"],
    ["41047001a@gapps.ntnu.edu.tw", "41047001a"],
    ["B11902001@ntu.edu.tw", "ntu_b11902001"],
    ["b11902001@g.ntu.edu.tw", "ntu_b11902001"],
    ["B11902001@mail.ntust.edu.tw", "ntust_b11902001"],
    ["b11902001@gapps.ntust.edu.tw", "ntust_b11902001"],
  ])("maps %s to the teacher-entered username %s", (email, username) => {
    const parsed = parseSchoolEmail(email);
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error("Expected a school identity");
    expect(extractStudentId(parsed.school, parsed.studentId)).toBe(username);
    expect(isCanonicalSchoolUsername(username)).toBe(true);
  });

  it.each(["b11902001", "ntnu_41047001a", "ntu_41047001a", "ntust_41047001a", "alice"])(
    "does not issue a school token for noncanonical username %s",
    async (username) => {
      await expect(initiateSchoolVerification("user-1", username)).resolves.toMatchObject({
        status: "error",
        httpStatus: 400,
      });
      expect(runTransaction).not.toHaveBeenCalled();
    },
  );
});

describe("verification preview is safe for mail-scanner GET requests", () => {
  it.each(["41047001a", "ntu_b11902001", "ntust_b11902001"])(
    "previews a live token for %s without consuming or changing identity",
    async (username) => {
      tokenFindById.mockResolvedValue({ ...liveToken, username });
      userFindByUsername.mockResolvedValue(null);
      await expect(peekSchoolVerification("token-1")).resolves.toEqual({
        status: "valid",
        username,
      });
      expect(tokenDelete).not.toHaveBeenCalled();
      expect(userUpdate).not.toHaveBeenCalled();
      expect(runTransaction).not.toHaveBeenCalled();
    },
  );

  it.each([null, { ...liveToken, expiresAt: new Date("2000-01-01T00:00:00Z") }])(
    "rejects missing or expired tokens without consuming them",
    async (record) => {
      tokenFindById.mockResolvedValue(record);
      await expect(peekSchoolVerification("token-1")).resolves.toMatchObject({
        status: "error",
      });
      expect(tokenDelete).not.toHaveBeenCalled();
      expect(userUpdate).not.toHaveBeenCalled();
      expect(runTransaction).not.toHaveBeenCalled();
    },
  );

  it("rejects a username claimed by another account", async () => {
    tokenFindById.mockResolvedValue(liveToken);
    userFindByUsername.mockResolvedValue({ id: "other" });
    await expect(peekSchoolVerification("token-1")).resolves.toMatchObject({ status: "error" });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(tokenDelete).not.toHaveBeenCalled();
  });

  it("allows a token belonging to the current username owner", async () => {
    tokenFindById.mockResolvedValue(liveToken);
    userFindByUsername.mockResolvedValue({ id: liveToken.userId });
    await expect(peekSchoolVerification("token-1")).resolves.toEqual({
      status: "valid",
      username: liveToken.username,
    });
  });
});
