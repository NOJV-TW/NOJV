import { describe, expect, it } from "vitest";

import { DEFAULT_NOTIFICATION_PREFERENCES, notificationPreferencesSchema } from "@nojv/core";

describe("notificationPreferencesSchema", () => {
  it("fills every field with its default when parsing an empty object", () => {
    expect(notificationPreferencesSchema.parse({})).toEqual({
      emailAssignmentStarted: true,
      emailAssignmentDueSoon: true,
      assignmentDueSoonLeadDays: 3,
      emailExamStarting: true,
      examStartingLeadDays: 1,
      emailContestStarting: true,
      contestStartingLeadDays: 1,
      emailSystemAnnouncement: true,
      emailCourseAnnouncement: true,
      emailCourseEnrolled: true,
      emailRoleChanged: true,
      emailEditorialRemoved: true,
    });
  });

  it("exposes the same defaults via DEFAULT_NOTIFICATION_PREFERENCES", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual(notificationPreferencesSchema.parse({}));
  });

  it("merges partial input with defaults", () => {
    const parsed = notificationPreferencesSchema.parse({
      emailAssignmentStarted: false,
      assignmentDueSoonLeadDays: 5,
    });
    expect(parsed.emailAssignmentStarted).toBe(false);
    expect(parsed.assignmentDueSoonLeadDays).toBe(5);
    expect(parsed.emailAssignmentDueSoon).toBe(true);
    expect(parsed.examStartingLeadDays).toBe(1);
  });

  it("rejects leadDays below 1, above 7, and non-integers", () => {
    expect(
      notificationPreferencesSchema.safeParse({ assignmentDueSoonLeadDays: 0 }).success,
    ).toBe(false);
    expect(
      notificationPreferencesSchema.safeParse({ assignmentDueSoonLeadDays: 8 }).success,
    ).toBe(false);
    expect(
      notificationPreferencesSchema.safeParse({ assignmentDueSoonLeadDays: 3.5 }).success,
    ).toBe(false);
    expect(notificationPreferencesSchema.safeParse({ examStartingLeadDays: 8 }).success).toBe(
      false,
    );
    expect(
      notificationPreferencesSchema.safeParse({ contestStartingLeadDays: 0 }).success,
    ).toBe(false);
  });

  it("strips unknown keys such as userId when sanitizing a persisted row", () => {
    const parsed = notificationPreferencesSchema.parse({
      userId: "user-123",
      emailRoleChanged: false,
    });
    expect(parsed).not.toHaveProperty("userId");
    expect(parsed.emailRoleChanged).toBe(false);
  });
});
