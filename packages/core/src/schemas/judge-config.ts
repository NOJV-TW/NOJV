import { z } from "zod";
import { judgeTypeSchema } from "../types";

// Authoritative judge configuration.

export const judgeScriptLanguageSchema = z.enum(["python", "cpp"]);

export type JudgeScriptLanguage = z.infer<typeof judgeScriptLanguageSchema>;

export const runtimeSchema = z.object({
  timeLimitMs: z.coerce.number().int().min(100).max(30_000).default(1_000),
  memoryLimitMb: z.coerce.number().int().min(16).max(1024).default(256),
  env: z.record(z.string().min(1).max(200), z.string().max(4_000)).default({}),
});

export type Runtime = z.infer<typeof runtimeSchema>;

export const judgeConfigSchema = z.object({
  type: judgeTypeSchema.default("standard"),

  // Checker / interactive scripts — accept both null and undefined since
  // older rows persisted explicit null while newer code writes undefined.
  checkerScript: z.string().max(200_000).nullish(),
  checkerLanguage: judgeScriptLanguageSchema.nullish(),
  interactorScript: z.string().max(200_000).nullish(),
  interactorLanguage: judgeScriptLanguageSchema.nullish(),

  // Runtime: authoritative source for time/memory limits + env.
  runtime: runtimeSchema.nullish(),
});

export type JudgeConfig = z.infer<typeof judgeConfigSchema>;
