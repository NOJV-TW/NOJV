export const examsPaths = {
  "/api/exam-sessions/{examId}/heartbeat": {
    post: {
      tags: ["Exams / Proctoring"],
      summary: "Record exam session heartbeat",
      operationId: "recordExamSessionHeartbeat",
      description:
        "Records a heartbeat for the current user's active exam session. If the session has already been released, the response still returns ok=true with released=true.",
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
          description: "Heartbeat processed",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ExamHeartbeatResponse" },
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
