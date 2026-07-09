import { z } from "zod";

const leadDaysSchema = z.number().int().min(1).max(7);

export const notificationPreferencesSchema = z.object({
  emailAssignmentStarted: z.boolean().default(true),
  emailAssignmentDueSoon: z.boolean().default(true),
  assignmentDueSoonLeadDays: leadDaysSchema.default(3),
  emailExamStarting: z.boolean().default(true),
  examStartingLeadDays: leadDaysSchema.default(1),
  emailContestStarting: z.boolean().default(true),
  contestStartingLeadDays: leadDaysSchema.default(1),
  emailSystemAnnouncement: z.boolean().default(true),
  emailCourseAnnouncement: z.boolean().default(true),
  emailCourseEnrolled: z.boolean().default(true),
  emailRoleChanged: z.boolean().default(true),
  emailEditorialRemoved: z.boolean().default(true),
});

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const DEFAULT_NOTIFICATION_PREFERENCES = notificationPreferencesSchema.parse({});
