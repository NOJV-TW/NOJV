import { z } from "zod";

import { languageSchema } from "../types";

// Shared content bounds — create + update must stay in sync.
const CONTENT_MIN = 10;
const CONTENT_MAX = 50_000;

export const editorialSubmitSchema = z.object({
  content: z.string().min(CONTENT_MIN).max(CONTENT_MAX),
  language: languageSchema,
});

export const editorialUpdateSchema = z
  .object({
    content: z.string().min(CONTENT_MIN).max(CONTENT_MAX).optional(),
    language: languageSchema.optional(),
  })
  .refine((value) => value.content !== undefined || value.language !== undefined, {
    message: "At least one field (content or language) is required.",
  });

export type EditorialSubmitInput = z.infer<typeof editorialSubmitSchema>;
export type EditorialUpdateInput = z.infer<typeof editorialUpdateSchema>;
