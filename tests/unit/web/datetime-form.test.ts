import { describe, expect, it } from "vitest";

import {
  isoDateTimeToLocal,
  localDateTimeToIso,
  restoreDateTimeFields,
  serializeDateTimeFormData,
  serializeDateTimeFields,
} from "$lib/utils/datetime-form";

describe("local datetime form conversion", () => {
  it("serializes a local wall-clock value with the browser offset", () => {
    expect(localDateTimeToIso("2026-09-07T16:30", -480)).toBe("2026-09-07T08:30:00.000Z");
  });

  it("converts an ISO value back to a local datetime input value", () => {
    expect(isoDateTimeToLocal("2026-09-07T08:30:00.000Z", -480)).toBe("2026-09-07T16:30");
  });

  it("serializes only the configured form fields", () => {
    expect(
      serializeDateTimeFields(
        { startsAt: "2026-09-07T16:30", title: "Exam" },
        ["startsAt"],
        -480,
      ),
    ).toEqual({ startsAt: "2026-09-07T08:30:00.000Z", title: "Exam" });
  });

  it("restores ISO values only for the configured form fields", () => {
    expect(
      restoreDateTimeFields(
        { startsAt: "2026-09-07T08:30:00.000Z", title: "Exam" },
        ["startsAt"],
        -480,
      ),
    ).toEqual({ startsAt: "2026-09-07T16:30", title: "Exam" });
  });

  it("serializes datetime-local values in a regular enhanced FormData submission", () => {
    const formData = new FormData();
    formData.set("expiresAt", "2026-09-07T16:30");
    serializeDateTimeFormData(formData, ["expiresAt"], -480);
    expect(formData.get("expiresAt")).toBe("2026-09-07T08:30:00.000Z");
  });
});
