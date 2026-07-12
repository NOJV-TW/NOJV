import { z } from "zod";
import { requiredPathsSchema, type AdvancedConfig } from "@nojv/core";
import { getWebEnv } from "./env";

export function allowedImageRegistries(): string[] {
  return getWebEnv()
    .ADVANCED_IMAGE_ALLOWED_REGISTRIES.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const pinnedImageRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(
    /^\S+@sha256:[0-9a-f]{64}$/,
    "Image references must be digest-pinned (…@sha256:<64 hex chars>).",
  )
  .superRefine((ref, ctx) => {
    const name = ref.slice(0, ref.indexOf("@"));
    const host = name.split("/")[0] ?? "";
    const registries = allowedImageRegistries();
    if (!registries.includes(host)) {
      ctx.addIssue({
        code: "custom",
        message: `Image registry "${host}" is not allowed. Allowed registries: ${registries.join(", ")}.`,
      });
    }
  });

export const advancedImageConfigInputSchema = z
  .object({
    runImageRef: pinnedImageRefSchema,
    gradeImageRef: pinnedImageRefSchema,
    networkMode: z.enum(["none", "allowlist", "service"]).default("none"),
    networkAllowlist: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
    serviceImageRef: pinnedImageRefSchema.optional(),
    maxScore: z.coerce.number().int().min(1).max(100_000).default(100),
    requiredPaths: requiredPathsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.networkMode === "allowlist" && value.networkAllowlist.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["networkAllowlist"],
        message: "Allowlist mode requires at least one host.",
      });
    }
    if (value.networkMode === "service" && value.serviceImageRef === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["serviceImageRef"],
        message: "Service mode requires a service image reference.",
      });
    }
  });

export type AdvancedImageConfigInput = z.infer<typeof advancedImageConfigInputSchema>;

export function buildAdvancedConfigFromInput(input: AdvancedImageConfigInput): AdvancedConfig {
  const network: AdvancedConfig["network"] =
    input.networkMode === "allowlist"
      ? { mode: "allowlist", allowlist: input.networkAllowlist }
      : input.networkMode === "service" && input.serviceImageRef !== undefined
        ? {
            mode: "service",
            service: { imageRef: input.serviceImageRef, imageSource: "registry" },
          }
        : { mode: "none" };

  return {
    run: { imageRef: input.runImageRef, imageSource: "registry" },
    grade: { imageRef: input.gradeImageRef, imageSource: "registry" },
    network,
    maxScore: input.maxScore,
  };
}
