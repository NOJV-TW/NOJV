import { describe, expect, it, vi } from "vitest";

const { listOAuthIdTokens } = vi.hoisted(() => ({ listOAuthIdTokens: vi.fn() }));
vi.mock("@nojv/db", () => ({ accountRepo: { listOAuthIdTokens } }));

import { userDomain } from "@nojv/application";

const { emailFromIdToken, listLinkedAccountEmails } = userDomain;

function jwt(payload: object): string {
  const b64 = (v: string) => Buffer.from(v).toString("base64url");
  return `${b64('{"alg":"RS256"}')}.${b64(JSON.stringify(payload))}.sig`;
}

describe("linked account emails from stored id_tokens", () => {
  it("reads the email claim without a network call and lowercases it", () => {
    expect(emailFromIdToken(jwt({ email: "41047000S@gapps.ntnu.edu.tw" }))).toBe(
      "41047000s@gapps.ntnu.edu.tw",
    );
  });

  it("yields nothing for a missing token, a non-JWT, or a payload without an email", () => {
    expect(emailFromIdToken(null)).toBeNull();
    expect(emailFromIdToken("ghp_not_a_jwt")).toBeNull();
    expect(emailFromIdToken(jwt({ sub: "1" }))).toBeNull();
  });

  it("keys accounts by provider and account id, skipping accounts without a claim", async () => {
    listOAuthIdTokens.mockResolvedValue([
      { providerId: "google", accountId: "g1", idToken: jwt({ email: "a@example.com" }) },
      { providerId: "github", accountId: "h1", idToken: null },
    ]);
    await expect(listLinkedAccountEmails("user-1")).resolves.toEqual({
      "google:g1": "a@example.com",
    });
  });
});
