import { defineRequestState, runWithRequestState } from "@better-auth/core/context";

export const factorMutationPath = {
  disable: "/two-factor/disable",
  deletePasskey: "/passkey/delete-passkey",
  enable: "/two-factor/enable",
  regenerateBackupCodes: "/two-factor/generate-backup-codes",
  verifyTotp: "/two-factor/verify-totp",
} as const;

export type FactorMutationPath = (typeof factorMutationPath)[keyof typeof factorMutationPath];

const internalAuthority = defineRequestState<FactorMutationPath | null>(() => null);

export async function runInternalFactorMutation<T>(
  path: FactorMutationPath,
  mutation: () => Promise<T>,
): Promise<T> {
  return runWithRequestState(new WeakMap(), async () => {
    await internalAuthority.set(path);
    return mutation();
  });
}

export async function consumeInternalFactorMutationAuthority(
  path: FactorMutationPath,
): Promise<boolean> {
  if ((await internalAuthority.get()) !== path) return false;
  await internalAuthority.set(null);
  return true;
}
