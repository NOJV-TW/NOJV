import { notificationPreferenceRepo } from "@nojv/db";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationPreferencesSchema,
  type NotificationPreferences,
} from "@nojv/core";

export async function getNotificationPreferences(userId: string) {
  return notificationPreferencesSchema.parse(
    (await notificationPreferenceRepo.get(userId)) ?? {},
  );
}

export async function updateNotificationPreferences(userId: string, input: unknown) {
  const prefs = notificationPreferencesSchema.parse(input);
  const row = await notificationPreferenceRepo.upsert(userId, prefs);
  return notificationPreferencesSchema.parse(row);
}

export async function getEffectiveNotificationPreferences(
  userIds: string[],
): Promise<Map<string, NotificationPreferences>> {
  const uniqueIds = Array.from(new Set(userIds));
  const result = new Map<string, NotificationPreferences>();
  if (uniqueIds.length === 0) return result;

  const rows = await notificationPreferenceRepo.findManyByUserIds(uniqueIds);
  const byUserId = new Map(rows.map((row) => [row.userId, row]));

  for (const userId of uniqueIds) {
    const row = byUserId.get(userId);
    result.set(
      userId,
      row ? notificationPreferencesSchema.parse(row) : DEFAULT_NOTIFICATION_PREFERENCES,
    );
  }

  return result;
}
