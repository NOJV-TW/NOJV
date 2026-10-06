export function isTestJudgeEnabled(): boolean {
  return process.env.TEST_JUDGE_ENABLED === "true";
}
