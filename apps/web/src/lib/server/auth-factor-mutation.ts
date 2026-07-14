import { defineRequestState, runWithRequestState } from "@better-auth/core/context";

export const factorMutationPath = {
  disable: "/two-factor/disable",
  deletePasskey: "/passkey/delete-passkey",
  enable: "/two-factor/enable",
  regenerateBackupCodes: "/two-factor/generate-backup-codes",
  verifyTotp: "/two-factor/verify-totp",
} as const;

export type FactorMutationPath = (typeof factorMutationPath)[keyof typeof factorMutationPath];

interface InternalFactorMutationAuthority {
  consumed: boolean;
  path: FactorMutationPath;
}

const internalAuthority = defineRequestState<InternalFactorMutationAuthority | null>(
  () => null,
);

export async function runInternalFactorMutation<T>(
  path: FactorMutationPath,
  mutation: () => Promise<T>,
): Promise<T> {
  return runWithRequestState(new WeakMap(), async () => {
    await internalAuthority.set({ consumed: false, path });
    return mutation();
  });
}

export async function consumeInternalFactorMutationAuthority(
  path: FactorMutationPath,
): Promise<boolean> {
  const authority = await internalAuthority.get();
  if (authority?.path !== path || authority.consumed) return false;
  authority.consumed = true;
  return true;
}
