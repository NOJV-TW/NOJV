import { describe, expect, it } from "vitest";

import { storageEnvSchema } from "../../../packages/storage/src/env";

describe("storageEnvSchema — centralized S3 env", () => {
  it("applies defaults for bucket and region when unset", () => {
    const env = storageEnvSchema.parse({});
    expect(env.S3_BUCKET).toBe("nojv");
    expect(env.S3_REGION).toBe("auto");
    expect(env.S3_ENDPOINT).toBeUndefined();
    expect(env.S3_ACCESS_KEY).toBeUndefined();
    expect(env.S3_SECRET_KEY).toBeUndefined();
  });

  it("preserves provided values", () => {
    const env = storageEnvSchema.parse({
      S3_BUCKET: "custom",
      S3_REGION: "us-east-1",
      S3_ENDPOINT: "http://localhost:9000",
      S3_ACCESS_KEY: "a",
      S3_SECRET_KEY: "s",
      S3_PUBLIC_URL: "https://cdn.example.com",
    });
    expect(env.S3_BUCKET).toBe("custom");
    expect(env.S3_REGION).toBe("us-east-1");
    expect(env.S3_ENDPOINT).toBe("http://localhost:9000");
    expect(env.S3_PUBLIC_URL).toBe("https://cdn.example.com");
  });
});
