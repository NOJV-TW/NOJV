import { z } from "zod";

export const SUBMISSION_PENDING_TIMEOUT_SETTING_KEY = "submission_pending_timeout_minutes";
export const DEFAULT_SUBMISSION_PENDING_TIMEOUT_MINUTES = 30;

export const submissionPendingTimeoutMinutesSchema = z.coerce.number().int().min(10).max(1440);
