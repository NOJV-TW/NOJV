import { createOTP } from "@better-auth/utils/otp";
import { generateRandomString, symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";

import {
  consumePendingTotpEnrollment,
  consumeTotpCode,
  isSecurityGenerationCurrent,
  readPendingTotpEnrollment,
  replaceTotpSecurityFactor,
  securityGenerationMarker,
  storePendingTotpEnrollment,
  type SecurityFactorState,
  type SecurityGenerationProof,
} from "@nojv/application";

import { getWebEnv } from "$lib/server/env";

interface PendingTotp {
  backupCodes: string;
  proof: SecurityGenerationProof;
  secret: string;
}

function authSecret(): string {
  const secret = getWebEnv().BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required for TOTP enrollment.");
  return secret;
}

async function createBackupCodes(): Promise<{
  backupCodes: string[];
  encryptedBackupCodes: string;
}> {
  const backupCodes = Array.from({ length: 10 }, () => {
    const code = generateRandomString(10, "a-z", "0-9", "A-Z");
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
  return {
    backupCodes,
    encryptedBackupCodes: await symmetricEncrypt({
      key: authSecret(),
      data: JSON.stringify(backupCodes),
    }),
  };
}

export async function startPendingTotp(
  sessionId: string,
  proof: SecurityGenerationProof,
  email: string,
): Promise<{ backupCodes: string[]; totpURI: string } | null> {
  if (!(await isSecurityGenerationCurrent(proof))) return null;
  const secret = generateRandomString(32);
  const backupCodes = await createBackupCodes();
  const pending: PendingTotp = {
    backupCodes: backupCodes.encryptedBackupCodes,
    proof,
    secret: await symmetricEncrypt({ key: authSecret(), data: secret }),
  };
  await storePendingTotpEnrollment(sessionId, JSON.stringify(pending));
  return {
    backupCodes: backupCodes.backupCodes,
    totpURI: createOTP(secret, { digits: 6, period: 30 }).url("NOJV", email),
  };
}

export type ConfirmPendingTotpResult =
  | { ok: true; state: SecurityFactorState }
  | { ok: false; reason: "expired" | "invalid" | "replayed" | "stale" };

export async function confirmPendingTotp(
  sessionId: string,
  proof: SecurityGenerationProof,
  code: string,
): Promise<ConfirmPendingTotpResult> {
  const raw = await readPendingTotpEnrollment(sessionId);
  if (!raw) return { ok: false, reason: "expired" };
  const pending = JSON.parse(raw) as PendingTotp;
  if (securityGenerationMarker(pending.proof) !== securityGenerationMarker(proof)) {
    return { ok: false, reason: "stale" };
  }
  const secret = await symmetricDecrypt({ key: authSecret(), data: pending.secret });
  if (!(await createOTP(secret, { digits: 6, period: 30 }).verify(code, { window: 1 }))) {
    return { ok: false, reason: "invalid" };
  }
  if (!(await consumePendingTotpEnrollment(sessionId, raw))) {
    return { ok: false, reason: "expired" };
  }
  if (!(await consumeTotpCode(proof.userId, code))) {
    return { ok: false, reason: "replayed" };
  }
  const encryptedSecret = await symmetricEncrypt({ key: authSecret(), data: secret });
  const state = await replaceTotpSecurityFactor({
    backupCodes: pending.backupCodes,
    expectedSecurityGeneration: proof.securityGeneration,
    secret: encryptedSecret,
    userId: proof.userId,
  });
  if (!state) return { ok: false, reason: "stale" };
  return { ok: true, state };
}

export async function generateNewBackupCodes(): Promise<{
  backupCodes: string[];
  encryptedBackupCodes: string;
}> {
  return createBackupCodes();
}
