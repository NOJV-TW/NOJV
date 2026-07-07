import { z } from "zod";

export const DEFAULT_SUBMISSION_PENDING_TIMEOUT_MINUTES = 10;

export const submissionPendingTimeoutMinutesSchema = z.coerce.number().int().min(10).max(1440);
