import {
  advancedConfigSchema,
  judgeConfigSchema,
  type AdvancedConfig,
  type JudgeConfig,
} from "@nojv/core";

import { IntegrityError } from "../shared/errors";

export function parsePersistedJudgeConfig(raw: unknown, problemId: string): JudgeConfig {
  if (raw == null) return { type: "standard" };
  const parsed = judgeConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new IntegrityError(
    `Invalid judgeConfig for problem ${problemId}: ${parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "judgeConfig"}: ${issue.message}`)
      .join("; ")}`,
  );
}

export function parsePersistedAdvancedConfig(
  raw: unknown,
  problemId: string,
): AdvancedConfig | null {
  if (raw == null) return null;
  const parsed = advancedConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new IntegrityError(
    `Invalid advancedConfig for problem ${problemId}: ${parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "advancedConfig"}: ${issue.message}`)
      .join("; ")}`,
  );
}
