import {
  adminAccessPrincipal,
  clearStepUp,
  clearVerifiedSessionProofs,
  consumeTotpCode,
  exitAdminMode,
  grantAdminMode,
  hasAdminSessionMfa,
  hasFreshStepUp,
  hasTokenPageMfa,
  isSecurityGenerationCurrent,
  isSuperAdminSessionExpired,
  markVerifiedSession,
  rebindVerifiedSessionAfterSecurityChange,
  resolveAdminAccess,
  revokeAdminAccess,
  securityGenerationMarker,
  securityGenerationProof,
  userHasCredentialPassword,
  validateStepUpCode,
  type SecurityGenerationProof,
} from "@nojv/application";

import { getAuth } from "$lib/auth.server";
import {
  factorMutationPath,
  runInternalFactorMutation,
} from "$lib/server/auth-factor-mutation";

export {
  adminAccessPrincipal,
  clearStepUp,
  clearVerifiedSessionProofs,
  consumeTotpCode,
  exitAdminMode,
  grantAdminMode,
  hasAdminSessionMfa,
  hasFreshStepUp,
  hasTokenPageMfa,
  isSecurityGenerationCurrent,
  isSuperAdminSessionExpired,
  markVerifiedSession,
  rebindVerifiedSessionAfterSecurityChange,
  resolveAdminAccess,
  revokeAdminAccess,
  securityGenerationMarker,
  securityGenerationProof,
  userHasCredentialPassword,
  validateStepUpCode,
};

export async function verifyTotpStepUp(code: string, headers: Headers): Promise<boolean> {
  try {
    await runInternalFactorMutation(factorMutationPath.verifyTotp, () =>
      getAuth().api.verifyTOTP({ body: { code }, headers }),
    );
    return true;
  } catch {
    return false;
  }
}

export type StepUpVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: "factor_unavailable" | "malformed" | "replayed" | "invalid" | "stale";
    };

export async function verifyStepUpCode(
  proof: SecurityGenerationProof,
  code: string,
  headers: Headers,
  twoFactorEnabled: boolean,
): Promise<StepUpVerifyResult> {
  if (validateStepUpCode(code)) {
    if (!twoFactorEnabled) return { ok: false, reason: "factor_unavailable" };
    if (!(await verifyTotpStepUp(code, headers))) return { ok: false, reason: "invalid" };
    if (!(await consumeTotpCode(proof.userId, code))) {
      return { ok: false, reason: "replayed" };
    }
    if (!(await isSecurityGenerationCurrent(proof))) return { ok: false, reason: "stale" };
    return { ok: true };
  }
  // Recovery codes remain available for account recovery through Better Auth,
  // but are intentionally not accepted for privileged step-up. Consuming one
  // mutates the factor state, so a pre-consumption authorization proof cannot
  // remain valid without unsafely rebinding to newer security state.
  return { ok: false, reason: "malformed" };
}
