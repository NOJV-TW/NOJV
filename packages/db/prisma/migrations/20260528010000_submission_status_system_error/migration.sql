-- Add system_error to SubmissionStatus enum. Terminal failure for submissions
-- the worker can't grade (e.g. storage write failed after the row committed).
ALTER TYPE "SubmissionStatus" ADD VALUE 'system_error';
