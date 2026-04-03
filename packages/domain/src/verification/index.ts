import { randomBytes } from "node:crypto";

import { userRepo, verificationRepo } from "@nojv/db";

// ─── Initiate school verification ──────────────────────────────────

export type InitiateVerificationResult =
  | { status: "error"; detail: string; httpStatus: 400 | 409 }
  | { status: "success"; token: string; expiresAt: Date };

/**
 * Create a school verification token after validating username uniqueness.
 * The caller is responsible for parsing the school email and sending the
 * verification email — those are infrastructure concerns outside the domain.
 */
export async function initiateSchoolVerification(
  userId: string,
  username: string,
  verificationData: Record<string, string>
): Promise<InitiateVerificationResult> {
  const existing = await userRepo.findByUsername(username);
  if (existing && existing.id !== userId) {
    return { status: "error", detail: "Username already taken", httpStatus: 409 };
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  await verificationRepo.create({
    id: token,
    identifier: userId,
    value: JSON.stringify(verificationData),
    expiresAt
  });

  return { status: "success", token, expiresAt };
}

// ─── Process school verification token ─────────────────────────────

export type VerifySchoolResult =
  | { status: "error"; detail: string }
  | { status: "success"; username: string };

/**
 * Process a school verification token.
 * Returns the result of the verification attempt.
 */
export async function processSchoolVerification(
  token: string,
  parseData: (value: string) => { username: string } | null
): Promise<VerifySchoolResult> {
  const record = await verificationRepo.findById(token);

  if (!record || record.expiresAt < new Date()) {
    if (record) {
      await verificationRepo.delete(token);
    }
    return { status: "error", detail: "驗證連結已過期或無效" };
  }

  const data = parseData(record.value);

  if (!data) {
    await verificationRepo.delete(token);
    return { status: "error", detail: "驗證資料格式錯誤" };
  }

  // Check username not taken by someone else
  const existing = await userRepo.findByUsername(data.username);
  if (existing && existing.id !== record.identifier) {
    await verificationRepo.delete(token);
    return { status: "error", detail: "此學號已被其他帳號使用" };
  }

  // Update user username
  await userRepo.update(record.identifier, {
    username: data.username,
    displayUsername: data.username
  });

  // Delete used token
  await verificationRepo.delete(token);

  return { status: "success", username: data.username };
}
