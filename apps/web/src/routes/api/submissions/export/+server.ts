import { z } from "zod";
import { submissionDomain } from "@nojv/application";
import type { RequestHandler } from "./$types";
import { requireApiAuth } from "#lib/server/auth.js";
import { apiHandler } from "#lib/server/shared/api-handler.js";

const querySchema = z.object({
  context: z.enum(["assignment", "exam", "contest"]),
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/),
  format: z.enum(["all", "csv", "zip"]),
});

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const query = querySchema.parse(Object.fromEntries(event.url.searchParams));
  const { fileName, body } = await submissionDomain.exportContextSubmissions(
    actor,
    { type: query.context, id: query.id },
    query.format,
  );
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": query.format === "csv" ? "text/csv; charset=utf-8" : "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
