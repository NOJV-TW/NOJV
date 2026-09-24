export const ADVANCED_WORKSPACE_MAX_BYTES = 1024 * 1024 * 1024;
export const ADVANCED_OUTPUT_MAX_FILES = 100_000;

export type RunState = "exited" | "timed_out" | "oom_killed";

export interface RunStatus {
  state: RunState;
  exitCode: number | null;
}
