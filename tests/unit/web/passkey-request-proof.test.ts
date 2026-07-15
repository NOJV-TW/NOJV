import {
  getRequestStateAsyncLocalStorage,
  runWithRequestState,
} from "@better-auth/core/context";
import { beforeAll, describe, expect, it } from "vitest";

import {
  getPasskeyAuthenticationProof,
  setPasskeyAuthenticationProof,
} from "$lib/server/passkey-request-proof";

const inRequest = <T>(run: () => T) => runWithRequestState(new WeakMap(), run);

beforeAll(async () => {
  // Better Auth initializes this before dispatching endpoints. Warm it here so
  // the test's first operation is the request concurrency under test, not lazy
  // AsyncLocalStorage construction.
  await getRequestStateAsyncLocalStorage();
});

describe("passkey authentication request proof", () => {
  it("isolates concurrent proofs for different users", async () => {
    let release!: () => void;
    const overlap = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = inRequest(async () => {
      await setPasskeyAuthenticationProof({
        credentialID: "credential-a",
        userId: "user-a",
        securityGeneration: 3,
      });
      await overlap;
      return getPasskeyAuthenticationProof();
    });
    const second = inRequest(async () => {
      await setPasskeyAuthenticationProof({
        credentialID: "credential-b",
        userId: "user-b",
        securityGeneration: 8,
      });
      await overlap;
      return getPasskeyAuthenticationProof();
    });

    release();

    await expect(first).resolves.toEqual({
      credentialID: "credential-a",
      userId: "user-a",
      securityGeneration: 3,
    });
    await expect(second).resolves.toEqual({
      credentialID: "credential-b",
      userId: "user-b",
      securityGeneration: 8,
    });
  });

  it("does not rebind concurrent proofs for the same user to a newer generation", async () => {
    let release!: () => void;
    const overlap = new Promise<void>((resolve) => {
      release = resolve;
    });

    const oldGeneration = inRequest(async () => {
      await setPasskeyAuthenticationProof({
        credentialID: "old-credential",
        userId: "user-a",
        securityGeneration: 4,
      });
      await overlap;
      return getPasskeyAuthenticationProof();
    });
    const newGeneration = inRequest(async () => {
      await setPasskeyAuthenticationProof({
        credentialID: "new-credential",
        userId: "user-a",
        securityGeneration: 5,
      });
      await overlap;
      return getPasskeyAuthenticationProof();
    });

    release();

    await expect(oldGeneration).resolves.toMatchObject({ securityGeneration: 4 });
    await expect(newGeneration).resolves.toMatchObject({ securityGeneration: 5 });
  });

  it("starts each request without a proof", async () => {
    await expect(inRequest(() => getPasskeyAuthenticationProof())).resolves.toBeNull();
  });
});
