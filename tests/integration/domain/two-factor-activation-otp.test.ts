import { afterEach, describe, expect, it } from "vitest";

import { storeActivationOtp, verifyActivationOtp } from "@nojv/application";
import { getRedis, keys } from "@nojv/redis";

const userId = "activation-otp-concurrency";

async function clearActivationOtp(): Promise<void> {
  await getRedis().del(
    keys.twoFactorActivationOtp(userId),
    keys.twoFactorActivationOtpAttempts(userId),
  );
}

afterEach(clearActivationOtp);

describe("activation OTP atomic consumption", () => {
  it("allows exactly one concurrent verifier to consume the code", async () => {
    await storeActivationOtp(userId, "123456");

    const results = await Promise.all([
      verifyActivationOtp(userId, "123456"),
      verifyActivationOtp(userId, "123456"),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "expired" }]);
  });
});
