import { z } from "zod";

import { isoDateTimeSchema, slugSchema } from "../types";

export const contestSessionSchema = z
  .object({
    contestSlug: slugSchema,
    endsAt: isoDateTimeSchema,
    frozenScoreboard: z.boolean(),
    startsAt: isoDateTimeSchema
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "endsAt must be later than startsAt",
    path: ["endsAt"]
  });

