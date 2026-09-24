import { afterEach, describe, expect, it } from "vitest";

import { storeSecuritySetupOtp, verifySecuritySetupOtp } from "@nojv/application";
import { getRedis, keys } from "@nojv/redis";

const userId = "security-settings-otp-concurrency";

afterEach(async () => {
  await getRedis().del(keys.securitySetupOtp(userId), keys.securitySetupOtpAttempts(userId));
});

describe("security settings OTP atomic consumption", () => {
  it("allows exactly one concurrent verifier to consume the code", async () => {
    await storeSecuritySetupOtp(userId, "123456");
    const results = await Promise.all([
      verifySecuritySetupOtp(userId, "123456"),
      verifySecuritySetupOtp(userId, "123456"),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "expired" }]);
  });
});
