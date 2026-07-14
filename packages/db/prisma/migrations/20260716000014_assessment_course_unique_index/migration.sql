CREATE UNIQUE INDEX CONCURRENTLY "Assessment_id_courseId_key"
ON "Assessment"("id", "courseId");
