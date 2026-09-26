import { z } from "zod";

export const notificationMarkAllReadSchema = z.object({
  action: z.literal("markAllRead"),
});

export const notificationMarkReadSchema = z.object({
  read: z.literal(true),
});
