import { describe, expect, it } from "vitest";

import { parseSchoolEmail, schoolAliasExample } from "../../../apps/web/src/lib/utils/school";

describe("parseSchoolEmail", () => {
  it("accepts student-ID addresses on known school domains", () => {
    expect(parseSchoolEmail("41047000s@ntnu.edu.tw")).toEqual({
      school: "ntnu",
      studentId: "41047000s",
    });
    expect(parseSchoolEmail("B10902000@g.ntu.edu.tw")).toEqual({
      school: "ntu",
      studentId: "b10902000",
    });
  });

  it("rejects alias local-parts and unknown domains", () => {
    expect(parseSchoolEmail("andylu@ntnu.edu.tw")).toBeNull();
    expect(parseSchoolEmail("41047000s@gmail.com")).toBeNull();
  });
});

describe("schoolAliasExample", () => {
  it("returns a student-ID example on the same domain for alias addresses", () => {
    expect(schoolAliasExample("andylu@ntnu.edu.tw")).toBe("41047000s@ntnu.edu.tw");
    expect(schoolAliasExample("andylu@gapps.ntnu.edu.tw")).toBe("41047000s@gapps.ntnu.edu.tw");
    expect(schoolAliasExample("somebody@g.ntu.edu.tw")).toBe("b10902000@g.ntu.edu.tw");
  });

  it("returns null for valid student-ID addresses and non-school domains", () => {
    expect(schoolAliasExample("41047000s@ntnu.edu.tw")).toBeNull();
    expect(schoolAliasExample("andylu@gmail.com")).toBeNull();
    expect(schoolAliasExample("no-at-sign")).toBeNull();
  });
});
