import { ipViolationLogRepo, type TransactionClient } from "@nojv/db";

export type ViolationType = "whitelist" | "binding";

export interface LogViolationInput {
  examId: string;
  userId: string;
  expectedIp: string | null;
  actualIp: string;
  violationType: ViolationType;
}

/**
 * Write an `IpViolationLog` row. Only exams have proctoring, so every row
 * is tied to an exam — contests are public and do not log IP events.
 */
export async function logViolation(input: LogViolationInput) {
  return ipViolationLogRepo.create(input);
}

export async function logViolationInTx(tx: TransactionClient, input: LogViolationInput) {
  return ipViolationLogRepo.withTx(tx).create(input);
}
