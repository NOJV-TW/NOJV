export const submissionExportPaths = {
  "/api/submissions/export": {
    get: {
      tags: ["Submissions"],
      summary: "Export all submissions for one activity",
      operationId: "exportContextSubmissions",
      description:
        "Requires the activity's submission-history management permission. Exports every page without UI filters. The all format bundles submissions.csv with the sources in one ZIP. CSV uses UTF-8 BOM and UTC timestamps. ZIP preserves source paths under user ID/problem ID/submission ID. New submissions after the initial history boundary are excluded; results reflect the time each page is read. Submissions without a source pointer receive SOURCE_UNAVAILABLE.txt; missing referenced objects abort the ZIP download. Blocked during exam confinement.",
      parameters: [
        {
          name: "context",
          in: "query",
          required: true,
          schema: { type: "string", enum: ["assignment", "exam", "contest"] },
        },
        {
          name: "id",
          in: "query",
          required: true,
          schema: { type: "string", minLength: 1, maxLength: 128, pattern: "^[a-zA-Z0-9_-]+$" },
        },
        {
          name: "format",
          in: "query",
          required: true,
          schema: { type: "string", enum: ["all", "csv", "zip"] },
        },
      ],
      responses: {
        "200": {
          description: "Download attachment; private, no-store",
          content: {
            "text/csv": { schema: { type: "string" } },
            "application/zip": { schema: { type: "string", format: "binary" } },
          },
        },
        "400": { description: "Invalid activity or format parameters" },
        "401": { description: "Authentication required" },
        "403": { description: "Activity management permission required or exam confinement" },
        "404": { description: "Activity not found" },
      },
    },
  },
};
