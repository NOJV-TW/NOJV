import type { Job } from "bullmq";

import {
  cheatingSignalSchema,
  evaluateIntegritySignals,
  integrityAssessmentSchema,
  type CheatingSignal
} from "@nojv/domain";

export function processCheatingSignal(job: Job<CheatingSignal>) {
  const payload = cheatingSignalSchema.parse(job.data);

  return Promise.resolve(integrityAssessmentSchema.parse(evaluateIntegritySignals([payload])));
}
