import { z } from "zod";
import { requiredPathsSchema, type AdvancedConfig } from "@nojv/core";
import { getWebEnv } from "./env";

export function allowedImageRegistries(): string[] {
  const webEnv = getWebEnv();
  const configured = webEnv.ADVANCED_IMAGE_ALLOWED_REGISTRIES.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const host = webEnv.REGISTRY_PUBLIC_HOST.trim();
  return host && !configured.includes(host) ? [host, ...configured] : configured;
}

export interface AdvancedImageConfigValidationContext {
  allowAnyPlatformRegistryNamespace: boolean;
  platformRegistryHost: string;
  platformRegistryNamespace: string | null;
}

function pinnedImageRefSchema(context: AdvancedImageConfigValidationContext) {
  return z
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
        return;
      }

      const platformHost = context.platformRegistryHost.trim();
      if (
        platformHost === "" ||
        host !== platformHost ||
        context.allowAnyPlatformRegistryNamespace
      ) {
        return;
      }

      const namespace = context.platformRegistryNamespace;
      if (!namespace) {
        ctx.addIssue({
          code: "custom",
          message: "Generate a registry push account before using platform registry images.",
        });
        return;
      }

      if (!name.startsWith(`${platformHost}/t/${namespace}/`)) {
        ctx.addIssue({
          code: "custom",
          message: `Platform registry images must be under your t/${namespace}/ namespace.`,
        });
      }
    });
}

export function createAdvancedImageConfigInputSchema(
  context: AdvancedImageConfigValidationContext,
) {
  const imageRef = pinnedImageRefSchema(context);
  return z
    .object({
      runImageRef: imageRef,
      gradeImageRef: imageRef,
      networkMode: z.enum(["none", "service"]).default("none"),
      serviceImageRef: imageRef.optional(),
      maxScore: z.coerce.number().int().min(1).max(100_000).default(100),
      requiredPaths: requiredPathsSchema,
    })
    .superRefine((value, ctx) => {
      if (value.networkMode === "service" && value.serviceImageRef === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["serviceImageRef"],
          message: "Service mode requires a service image reference.",
        });
      }
    });
}

export type AdvancedImageConfigInput = z.infer<
  ReturnType<typeof createAdvancedImageConfigInputSchema>
>;

export function buildAdvancedConfigFromInput(input: AdvancedImageConfigInput): AdvancedConfig {
  const network: AdvancedConfig["network"] =
    input.networkMode === "service" && input.serviceImageRef !== undefined
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
