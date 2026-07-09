import { describe, expect, it } from "vitest";

import { DEFAULT_NOTIFICATION_PREFERENCES } from "@nojv/core";
import { notificationPreferenceRepo } from "@nojv/db";
import { notificationDomain } from "@nojv/application";

import { createTestUser } from "../../fixtures/factories";

describe("notificationPreferenceRepo", () => {
  it("returns null before any preference row exists", async () => {
    const user = await createTestUser();
    expect(await notificationPreferenceRepo.get(user.id)).toBeNull();
  });

  it("findManyByUserIds returns an empty array for an empty input", async () => {
    expect(await notificationPreferenceRepo.findManyByUserIds([])).toEqual([]);
  });

  it("upsert creates then updates the same row across repeated calls", async () => {
    const user = await createTestUser();

    await notificationPreferenceRepo.upsert(user.id, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      emailAssignmentStarted: false,
    });
    expect((await notificationPreferenceRepo.get(user.id))?.emailAssignmentStarted).toBe(false);

    await notificationPreferenceRepo.upsert(user.id, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      emailAssignmentStarted: true,
      assignmentDueSoonLeadDays: 6,
    });
    const row = await notificationPreferenceRepo.get(user.id);
    expect(row?.emailAssignmentStarted).toBe(true);
    expect(row?.assignmentDueSoonLeadDays).toBe(6);
  });
});

describe("notificationDomain preferences accessors", () => {
  it("getNotificationPreferences returns defaults when no row exists", async () => {
    const user = await createTestUser();
    expect(await notificationDomain.getNotificationPreferences(user.id)).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
  });

  it("updateNotificationPreferences validates, persists, and returns the stored values", async () => {
    const user = await createTestUser();
    const updated = await notificationDomain.updateNotificationPreferences(user.id, {
      emailContestStarting: false,
      contestStartingLeadDays: 7,
    });
    expect(updated.emailContestStarting).toBe(false);
    expect(updated.contestStartingLeadDays).toBe(7);
    expect(updated.emailAssignmentStarted).toBe(true);

    expect(await notificationDomain.getNotificationPreferences(user.id)).toEqual(updated);
  });

  it("updateNotificationPreferences rejects out-of-range leadDays", async () => {
    const user = await createTestUser();
    await expect(
      notificationDomain.updateNotificationPreferences(user.id, {
        contestStartingLeadDays: 99,
      }),
    ).rejects.toThrow();
  });
});

describe("getEffectiveNotificationPreferences", () => {
  it("returns an empty map for an empty input", async () => {
    const map = await notificationDomain.getEffectiveNotificationPreferences([]);
    expect(map.size).toBe(0);
  });

  it("returns defaults for a user without a row", async () => {
    const user = await createTestUser();
    const map = await notificationDomain.getEffectiveNotificationPreferences([user.id]);
    expect(map.get(user.id)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it("deduplicates repeated userIds", async () => {
    const user = await createTestUser();
    const map = await notificationDomain.getEffectiveNotificationPreferences([
      user.id,
      user.id,
    ]);
    expect(map.size).toBe(1);
    expect(map.get(user.id)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it("reads stored values back, sanitized of the userId column", async () => {
    const user = await createTestUser();
    await notificationDomain.updateNotificationPreferences(user.id, {
      emailAssignmentStarted: false,
      assignmentDueSoonLeadDays: 5,
    });

    const map = await notificationDomain.getEffectiveNotificationPreferences([user.id]);
    const prefs = map.get(user.id);
    expect(prefs).toBeDefined();
    expect(prefs).not.toHaveProperty("userId");
    expect(prefs?.emailAssignmentStarted).toBe(false);
    expect(prefs?.assignmentDueSoonLeadDays).toBe(5);
    expect(prefs?.emailExamStarting).toBe(true);
  });

  it("mixes stored rows with defaults for users lacking a row", async () => {
    const stored = await createTestUser();
    const missing = await createTestUser();
    await notificationDomain.updateNotificationPreferences(stored.id, {
      emailRoleChanged: false,
    });

    const map = await notificationDomain.getEffectiveNotificationPreferences([
      stored.id,
      missing.id,
    ]);
    expect(map.get(stored.id)?.emailRoleChanged).toBe(false);
    expect(map.get(missing.id)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });
});
