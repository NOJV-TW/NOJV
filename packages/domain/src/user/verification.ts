import { randomBytes } from "node:crypto";

import { schoolVerificationTokenRepo, userRepo } from "@nojv/db";

export type InitiateVerificationResult =
  | { status: "error"; detail: string; httpStatus: 400 | 409 }
  | { status: "success"; token: string; expiresAt: Date };

/**
 * Tokens live in their own table, separate from better-auth's `Verification`
 * table, so neither side's cleanup sweeps interfere with the other.
 */
export async function initiateSchoolVerification(
  userId: string,
  username: string,
): Promise<InitiateVerificationResult> {
  const existing = await userRepo.findByUsername(username);
  if (existing && existing.id !== userId) {
    return { status: "error", detail: "Username already taken", httpStatus: 409 };
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  await schoolVerificationTokenRepo.create({
    token,
    userId,
    username,
    expiresAt,
  });

  return { status: "success", token, expiresAt };
}

export type VerifySchoolResult =
  | { status: "error"; detail: string }
  | { status: "success"; username: string };

export async function processSchoolVerification(token: string): Promise<VerifySchoolResult> {
  const record = await schoolVerificationTokenRepo.findById(token);

  if (!record || record.expiresAt < new Date()) {
    if (record) {
      await schoolVerificationTokenRepo.delete(token);
    }
    return { status: "error", detail: "驗證連結已過期或無效" };
  }

  // Check username not taken by someone else
  const existing = await userRepo.findByUsername(record.username);
  if (existing && existing.id !== record.userId) {
    await schoolVerificationTokenRepo.delete(token);
    return { status: "error", detail: "此學號已被其他帳號使用" };
  }

  // Update user username
  await userRepo.update(record.userId, {
    username: record.username,
    displayUsername: record.username,
  });

  // Delete used token
  await schoolVerificationTokenRepo.delete(token);

  return { status: "success", username: record.username };
}
