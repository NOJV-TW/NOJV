import { defineRequestState } from "@better-auth/core/context";

import type { SecurityGenerationProof } from "@nojv/application";

export type PasskeyAuthenticationProof = SecurityGenerationProof & {
  authenticatedAt?: string;
  credentialID: string;
  passwordProofTicket?: string;
};

export type PasskeyRegistrationProof = SecurityGenerationProof & {
  credentialID: string;
  sessionId: string;
};

const proofState = defineRequestState<PasskeyAuthenticationProof | null>(() => null);
const registrationState = defineRequestState<PasskeyRegistrationProof | null>(() => null);

export function getPasskeyAuthenticationProof(): Promise<PasskeyAuthenticationProof | null> {
  return proofState.get();
}

export function setPasskeyAuthenticationProof(
  proof: PasskeyAuthenticationProof,
): Promise<void> {
  return proofState.set(proof);
}

export function getPasskeyRegistrationProof(): Promise<PasskeyRegistrationProof | null> {
  return registrationState.get();
}

export function setPasskeyRegistrationProof(proof: PasskeyRegistrationProof): Promise<void> {
  return registrationState.set(proof);
}
