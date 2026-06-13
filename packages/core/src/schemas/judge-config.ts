import { z } from "zod";
import { judgeTypeSchema } from "../types";

export const judgeScriptLanguageSchema = z.enum(["python", "cpp"]);

export type JudgeScriptLanguage = z.infer<typeof judgeScriptLanguageSchema>;

export const runtimeSchema = z.object({
  timeLimitMs: z.coerce.number().int().min(100).max(30_000).default(1_000),
  memoryLimitMb: z.coerce.number().int().min(16).max(1024).default(256),
  env: z.record(z.string().min(1).max(200), z.string().max(4_000)).default({}),
});

export type Runtime = z.infer<typeof runtimeSchema>;

export const compareOptionsSchema = z.object({
  caseSensitive: z.boolean().default(true),
  floatTolerance: z.number().positive().max(1).nullish(),
});

export type CompareConfig = z.infer<typeof compareOptionsSchema>;

export const judgeConfigSchema = z.object({
  type: judgeTypeSchema.default("standard"),

  checkerKey: z.string().max(500).nullish(),
  checkerLanguage: judgeScriptLanguageSchema.nullish(),
  interactorKey: z.string().max(500).nullish(),
  interactorLanguage: judgeScriptLanguageSchema.nullish(),

  compare: compareOptionsSchema.nullish(),

  runtime: runtimeSchema.nullish(),
});

export type JudgeConfig = z.infer<typeof judgeConfigSchema>;
