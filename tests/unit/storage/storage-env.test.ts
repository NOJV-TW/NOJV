import { describe, expect, it } from "vitest";

import {
  storageEnvSchema,
  STORAGE_REQUIRED_IN_PRODUCTION,
} from "../../../packages/storage/src/env";

describe("storageEnvSchema — centralized S3 env", () => {
  it("applies defaults for bucket and region when unset", () => {
    const env = storageEnvSchema.parse({});
    expect(env.S3_BUCKET).toBe("nojv");
    expect(env.S3_REGION).toBe("auto");
    expect(env.S3_ENDPOINT).toBeUndefined();
    expect(env.S3_ACCESS_KEY).toBeUndefined();
    expect(env.S3_SECRET_KEY).toBeUndefined();
  });

  it("fails fast in production when an S3 credential is missing", () => {
    for (const key of STORAGE_REQUIRED_IN_PRODUCTION) {
      const env: Record<string, string> = {
        NODE_ENV: "production",
        S3_ENDPOINT: "https://storage.googleapis.com",
        S3_ACCESS_KEY: "a",
        S3_SECRET_KEY: "s",
      };
      delete env[key];
      const result = storageEnvSchema.safeParse(env);
      expect(result.success, `missing ${key} should fail in production`).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === key)).toBe(true);
      }
    }
  });

  it("passes in production when every S3 credential is present", () => {
    const result = storageEnvSchema.safeParse({
      NODE_ENV: "production",
      S3_ENDPOINT: "https://storage.googleapis.com",
      S3_ACCESS_KEY: "a",
      S3_SECRET_KEY: "s",
    });
    expect(result.success).toBe(true);
  });

  it("preserves provided values", () => {
    const env = storageEnvSchema.parse({
      S3_BUCKET: "custom",
      S3_REGION: "us-east-1",
      S3_ENDPOINT: "http://localhost:9000",
      S3_ACCESS_KEY: "a",
      S3_SECRET_KEY: "s",
    });
    expect(env.S3_BUCKET).toBe("custom");
    expect(env.S3_REGION).toBe("us-east-1");
    expect(env.S3_ENDPOINT).toBe("http://localhost:9000");
  });
});
