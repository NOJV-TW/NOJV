import {
  MAX_SUBMISSION_BODY_BYTES,
  submissionDraftSchema,
  submissionOperationStatusSchema,
  languageSchema,
} from "@nojv/core";
import { submissionDomain, HttpError } from "@nojv/application";
import { error, json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler, writeApiHandler, readJsonBody } from "$lib/server/shared/api-handler";
import { getClientIp } from "$lib/server/shared/client-ip";

const SUBMISSIONS_PAGE_SIZE = 50;
const contextQuerySchema = z.object({
  context: z.enum(["assignment", "exam", "contest"]),
  id: z.string().min(1),
});

const historyQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  snapshot: z.string().min(1).max(1024).optional(),
  filterProblemId: z.string().min(1).max(128).optional(),
  status: submissionOperationStatusSchema.optional(),
  language: languageSchema.optional(),
  contextType: z.enum(["practice", "assignment", "contest", "exam", "virtual"]).optional(),
  search: z.string().trim().max(200).optional(),
  userSearch: z.string().trim().max(200).optional(),
  ipSearch: z.string().trim().max(200).optional(),
});

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  if (event.url.searchParams.has("problemId")) {
    const problemId = z.string().min(1).parse(event.url.searchParams.get("problemId"));
    let contextInput: unknown;
    try {
      contextInput = JSON.parse(event.url.searchParams.get("workspaceContext") ?? "null");
    } catch {
      error(400, "Invalid workspace context.");
    }
    const context = submissionDraftSchema.shape.context.parse(contextInput);
    const cursor = event.url.searchParams.get("cursor")?.trim();
    return json(
      await submissionDomain.listWorkspaceSubmissions({
        actor,
        problemId,
        context,
        ...(cursor ? { cursor } : {}),
      }),
    );
  }
  const query = historyQuerySchema.parse(Object.fromEntries(event.url.searchParams));
  const options = {
    actor,
    limit: SUBMISSIONS_PAGE_SIZE,
    page: query.page,
    ...(query.snapshot ? { snapshot: query.snapshot } : {}),
    filters: {
      ...(query.filterProblemId ? { problemId: query.filterProblemId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.language ? { language: query.language } : {}),
      ...(query.contextType ? { contextType: query.contextType } : {}),
      ...(query.search ? { search: query.search } : {}),
      ...(query.userSearch ? { userSearch: query.userSearch } : {}),
      ...(query.ipSearch ? { ipSearch: query.ipSearch } : {}),
    },
  };
  const contextType = event.url.searchParams.get("context");
  const contextId = event.url.searchParams.get("id");
  if (contextType !== null || contextId !== null) {
    const context = contextQuerySchema.parse({ context: contextType, id: contextId });
    return json(
      await submissionDomain.listContextSubmissionsPaged({
        ...options,
        context: { type: context.context, id: context.id },
      }),
    );
  }
  return json(await submissionDomain.listUserSubmissions(options));
});

function submitRejectionBody(err: HttpError): { code: string; retryAfterSec?: number } {
  const message = err.message;
  if (/cooldown/i.test(message)) {
    const seconds = Number(/(\d+)/.exec(message)?.[1] ?? "");
    return Number.isFinite(seconds) && seconds > 0
      ? { code: "submit_cooldown", retryAfterSec: seconds }
      : { code: "submit_cooldown" };
  }
  if (/daily submission limit/i.test(message)) return { code: "daily_limit" };
  if (/(has ended|has not opened)/i.test(message)) return { code: "window_closed" };
  if (/(network does not match|network is not permitted|ip restrictions)/i.test(message)) {
    return { code: "ip_blocked" };
  }
  if (/language not allowed/i.test(message)) return { code: "language_not_allowed" };
  return { code: "submit_rejected" };
}

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const declared = Number(event.request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_SUBMISSION_BODY_BYTES) {
    error(413, "Request body too large");
  }

  const payload = submissionDraftSchema.parse(
    await readJsonBody(event, MAX_SUBMISSION_BODY_BYTES),
  );

  try {
    const submission = await submissionDomain.submitAndDispatch(
      payload,
      actor,
      getClientIp(event),
    );
    return json(
      {
        pollUrl: `/api/submissions/${submission.id}`,
        status: submission.status,
        submissionId: submission.id,
      },
      { status: 202 },
    );
  } catch (err) {
    if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
      return json(
        { message: err.message, ...submitRejectionBody(err) },
        { status: err.status },
      );
    }
    throw err;
  }
});
