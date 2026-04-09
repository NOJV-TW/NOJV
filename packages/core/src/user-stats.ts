import { z } from "zod";

export const dailyActivitySchema = z.object({
  date: z.string(),
  acCount: z.number().int().nonnegative()
});

export const dailyActivityArraySchema = z.array(dailyActivitySchema);

export const languageDistSchema = z.record(z.string(), z.number().int().nonnegative());
export const difficultyDistSchema = z.record(z.string(), z.number().int().nonnegative());

export type DailyActivity = z.infer<typeof dailyActivitySchema>;
export type LanguageDist = z.infer<typeof languageDistSchema>;
export type DifficultyDist = z.infer<typeof difficultyDistSchema>;
