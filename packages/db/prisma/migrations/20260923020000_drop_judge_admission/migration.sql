-- expand-contract-ok: Temporal task-queue priority replaced the capacity coordinator (#487). No code reads JudgeAdmission (empty in production) or JudgeExecution.capacityStrategy, and the release runs inside the migration maintenance window.
DROP TABLE "JudgeAdmission";
ALTER TABLE "JudgeExecution" DROP COLUMN "capacityStrategy";
