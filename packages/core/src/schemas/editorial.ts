import { z } from "zod";

import { languageSchema } from "../types";

const TITLE_MIN = 1;
const TITLE_MAX = 200;
const CONTENT_MIN = 10;
const CONTENT_MAX = 50_000;
const REASON_MIN = 1;
const REASON_MAX = 1000;

export const editorialSubmitSchema = z.object({
  title: z.string().trim().min(TITLE_MIN).max(TITLE_MAX),
  content: z.string().min(CONTENT_MIN).max(CONTENT_MAX),
  language: languageSchema,
});

export const editorialUpdateSchema = z
  .object({
    title: z.string().trim().min(TITLE_MIN).max(TITLE_MAX).optional(),
    content: z.string().min(CONTENT_MIN).max(CONTENT_MAX).optional(),
    language: languageSchema.optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined || value.content !== undefined || value.language !== undefined,
    {
      message: "At least one field (title, content, or language) is required.",
    },
  );

export const editorialVoteSchema = z.object({
  value: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
});

export const editorialReportSchema = z.object({
  reason: z.string().min(REASON_MIN).max(REASON_MAX),
});

export const editorialEntrySchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  language: z.string(),
  createdAt: z.string(),
  voteScore: z.number(),
  viewerVote: z.number(),
  user: z.object({
    username: z.string().nullable(),
    name: z.string(),
  }),
});

export const editorialListResponseSchema = z.array(editorialEntrySchema);

export type EditorialSubmitInput = z.infer<typeof editorialSubmitSchema>;
export type EditorialUpdateInput = z.infer<typeof editorialUpdateSchema>;
export type EditorialVoteInput = z.infer<typeof editorialVoteSchema>;
export type EditorialReportInput = z.infer<typeof editorialReportSchema>;
