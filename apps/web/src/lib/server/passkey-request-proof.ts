import { defineRequestState } from "@better-auth/core/context";

import type { SecurityGenerationProof } from "@nojv/application";

export type PasskeyAuthenticationProof = SecurityGenerationProof & {
  credentialID: string;
};

const proofState = defineRequestState<PasskeyAuthenticationProof | null>(() => null);

export function getPasskeyAuthenticationProof(): Promise<PasskeyAuthenticationProof | null> {
  return proofState.get();
}

export function setPasskeyAuthenticationProof(
  proof: PasskeyAuthenticationProof,
): Promise<void> {
  return proofState.set(proof);
}
