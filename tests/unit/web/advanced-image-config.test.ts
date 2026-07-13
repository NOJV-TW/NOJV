import { describe, expect, it } from "vitest";
import { advancedConfigSchema } from "@nojv/core";

const {
  buildAdvancedConfigFromInput,
  createAdvancedImageConfigInputSchema,
  allowedImageRegistries,
} = await import("$lib/server/advanced-image-config");

const advancedImageConfigInputSchema = createAdvancedImageConfigInputSchema({
  allowAnyPlatformRegistryNamespace: false,
  platformRegistryHost: "",
  platformRegistryNamespace: null,
});

const DIGEST = `sha256:${"a".repeat(64)}`;

const baseInput = {
  runImageRef: `ghcr.io/nojv-tw/run@${DIGEST}`,
  gradeImageRef: `docker.io/library/python@${DIGEST}`,
};

describe("advancedImageConfigInputSchema", () => {
  it("defaults the allowlist to the major public registries", () => {
    expect(allowedImageRegistries()).toEqual([
      "ghcr.io",
      "docker.io",
      "quay.io",
      "registry.gitlab.com",
      "gcr.io",
      "public.ecr.aws",
      "mcr.microsoft.com",
      "registry.k8s.io",
    ]);
  });

  it("accepts digest-pinned refs from allowed registries", () => {
    const parsed = advancedImageConfigInputSchema.safeParse(baseInput);
    expect(parsed.success).toBe(true);
  });

  it("rejects tag-based refs without a digest", () => {
    const parsed = advancedImageConfigInputSchema.safeParse({
      ...baseInput,
      runImageRef: "ghcr.io/nojv-tw/run:main",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain("digest-pinned");
  });

  it("rejects digest-pinned refs from registries outside the allowlist", () => {
    const parsed = advancedImageConfigInputSchema.safeParse({
      ...baseInput,
      gradeImageRef: `evil.example.com/x/y@${DIGEST}`,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain("not allowed");
  });

  it("rejects the removed allowlist network mode", () => {
    expect(
      advancedImageConfigInputSchema.safeParse({ ...baseInput, networkMode: "allowlist" })
        .success,
    ).toBe(false);
  });

  it("requires a service image in service mode", () => {
    const parsed = advancedImageConfigInputSchema.safeParse({
      ...baseInput,
      networkMode: "service",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects another teacher's platform-registry namespace", () => {
    const schema = createAdvancedImageConfigInputSchema({
      allowAnyPlatformRegistryNamespace: false,
      platformRegistryHost: "docker.io",
      platformRegistryNamespace: "alice",
    });
    const parsed = schema.safeParse({
      runImageRef: `docker.io/t/alice/run@${DIGEST}`,
      gradeImageRef: `docker.io/t/bob/grade@${DIGEST}`,
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain("t/alice");
  });

  it("allows an admin to reference any platform-registry namespace", () => {
    const schema = createAdvancedImageConfigInputSchema({
      allowAnyPlatformRegistryNamespace: true,
      platformRegistryHost: "docker.io",
      platformRegistryNamespace: null,
    });

    expect(
      schema.safeParse({
        runImageRef: `docker.io/t/alice/run@${DIGEST}`,
        gradeImageRef: `docker.io/t/bob/grade@${DIGEST}`,
      }).success,
    ).toBe(true);
  });
});

describe("buildAdvancedConfigFromInput", () => {
  it("maps none mode to a config the core schema accepts", () => {
    const input = advancedImageConfigInputSchema.parse(baseInput);
    const config = buildAdvancedConfigFromInput(input);
    expect(advancedConfigSchema.safeParse(config).success).toBe(true);
    expect(config.run).toEqual({ imageRef: baseInput.runImageRef, imageSource: "registry" });
    expect(config.network).toEqual({ mode: "none" });
    expect(config.maxScore).toBe(100);
  });

  it("maps service mode with a registry service image", () => {
    const input = advancedImageConfigInputSchema.parse({
      ...baseInput,
      networkMode: "service",
      serviceImageRef: `ghcr.io/nojv-tw/svc@${DIGEST}`,
      maxScore: 200,
    });
    const config = buildAdvancedConfigFromInput(input);
    expect(advancedConfigSchema.safeParse(config).success).toBe(true);
    expect(config.network).toEqual({
      mode: "service",
      service: { imageRef: `ghcr.io/nojv-tw/svc@${DIGEST}`, imageSource: "registry" },
    });
    expect(config.maxScore).toBe(200);
  });
});
