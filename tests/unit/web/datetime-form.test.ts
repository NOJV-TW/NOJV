import { describe, expect, it } from "vitest";

import {
  isoDateTimeToLocal,
  localDateTimeToIso,
  restoreDateTimeFields,
  serializeDateTimeFormData,
  serializeDateTimeFields,
} from "#lib/utils/datetime-form.js";

describe("local datetime form conversion", () => {
  it("serializes a local wall-clock value as Taiwan time", () => {
    expect(localDateTimeToIso("2026-09-07T16:30")).toBe("2026-09-07T08:30:00.000Z");
  });

  it("converts an ISO value back to a local datetime input value", () => {
    expect(isoDateTimeToLocal("2026-09-07T08:30:00.000Z")).toBe("2026-09-07T16:30");
  });

  it("keeps calendar boundaries stable and rejects an invalid local date", () => {
    expect(localDateTimeToIso("2026-11-06T00:05")).toBe("2026-11-05T16:05:00.000Z");
    expect(isoDateTimeToLocal("2026-11-06T00:05")).toBe("2026-11-06T00:05");
    expect(localDateTimeToIso("2026-02-30T12:00")).toBeUndefined();
  });

  it("serializes only the configured form fields", () => {
    expect(
      serializeDateTimeFields({ startsAt: "2026-09-07T16:30", title: "Exam" }, ["startsAt"]),
    ).toEqual({ startsAt: "2026-09-07T08:30:00.000Z", title: "Exam" });
  });

  it("restores ISO values only for the configured form fields", () => {
    expect(
      restoreDateTimeFields({ startsAt: "2026-09-07T08:30:00.000Z", title: "Exam" }, [
        "startsAt",
      ]),
    ).toEqual({ startsAt: "2026-09-07T16:30", title: "Exam" });
  });

  it("preserves seconds in unchanged settings while serializing an edited deadline", () => {
    expect(
      serializeDateTimeFields(
        { startsAt: "2026-09-07T16:30", endsAt: "2026-09-07T18:00" },
        ["startsAt", "endsAt"],
        { startsAt: "2026-09-07T08:30:30.123Z", endsAt: "2026-09-07T09:00:45.000Z" },
      ),
    ).toEqual({ startsAt: "2026-09-07T08:30:30.123Z", endsAt: "2026-09-07T10:00:00.000Z" });
  });

  it("serializes datetime-local values in a regular enhanced FormData submission", () => {
    const formData = new FormData();
    formData.set("expiresAt", "2026-09-07T16:30");
    serializeDateTimeFormData(formData, ["expiresAt"]);
    expect(formData.get("expiresAt")).toBe("2026-09-07T08:30:00.000Z");
  });
});
