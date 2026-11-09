export const examsPaths = {
  "/api/exams/{examId}/entry-attempt": {
    post: {
      tags: ["Exams / Proctoring"],
      summary: "Record an explicit exam navigation attempt",
      operationId: "recordExamEntryAttempt",
      description:
        "Session-only client navigation audit. Applies the exam gate and records throttled IP violations without opening a session. Background refreshes must not call this endpoint. Course managers are exempt.",
      parameters: [{ name: "examId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "204": { description: "Attempt checked" },
        "401": { description: "Authentication required" },
        "403": { description: "Exam access denied or CSRF validation failed" },
        "404": { description: "Exam not found" },
        "429": { description: "Too many requests" },
        "503": { description: "Gate or rate limiter unavailable" },
      },
    },
  },
  "/api/exams/{examId}/ip-violations": {
    get: {
      tags: ["Exams / Proctoring"],
      summary: "List exam IP violations",
      operationId: "listExamIpViolations",
      description:
        "Lists recent IP gate violations for an exam. Admins, exam managers, and authorized course staff can view this data.",
      parameters: [
        {
          name: "examId",
          in: "path",
          required: true,
          description: "Exam ID.",
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Exam IP violations",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ExamIpViolationListResponse" },
            },
          },
        },
        "400": {
          description: "Missing examId",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "403": {
          description: "Not authorized to view this exam's IP violations",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
        "404": {
          description: "Exam not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorResponse" },
            },
          },
        },
      },
    },
  },
} as const;
