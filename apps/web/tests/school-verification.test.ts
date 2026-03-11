import { describe, expect, it } from "vitest";

import {
  extractStudentId,
  isReservedHandle,
  isStudentIdFormat,
  parseSchoolEmail
} from "../src/lib/school-verification";

describe("parseSchoolEmail", () => {
  // NTNU: 8 digits + 1 letter
  it("parses NTNU primary email", () => {
    const r = parseSchoolEmail("41071234A@ntnu.edu.tw");
    expect(r).toEqual({ school: "ntnu", studentId: "41071234a" });
  });

  it("parses NTNU gapps email", () => {
    const r = parseSchoolEmail("41071234a@gapps.ntnu.edu.tw");
    expect(r).toEqual({ school: "ntnu", studentId: "41071234a" });
  });

  // NTU: 1 letter + 8 digits
  it("parses NTU primary email", () => {
    const r = parseSchoolEmail("B12345678@ntu.edu.tw");
    expect(r).toEqual({ school: "ntu", studentId: "b12345678" });
  });

  it("parses NTU g.ntu email", () => {
    const r = parseSchoolEmail("b12345678@g.ntu.edu.tw");
    expect(r).toEqual({ school: "ntu", studentId: "b12345678" });
  });

  // NTUST: 1 letter + 8 digits
  it("parses NTUST mail email", () => {
    const r = parseSchoolEmail("B12345678@mail.ntust.edu.tw");
    expect(r).toEqual({ school: "ntust", studentId: "b12345678" });
  });

  it("parses NTUST gapps email", () => {
    const r = parseSchoolEmail("b12345678@gapps.ntust.edu.tw");
    expect(r).toEqual({ school: "ntust", studentId: "b12345678" });
  });

  it("returns null for non-school email", () => {
    expect(parseSchoolEmail("user@gmail.com")).toBeNull();
  });

  it("returns null for invalid student ID format", () => {
    expect(parseSchoolEmail("notavalid@ntnu.edu.tw")).toBeNull();
  });
});

describe("extractStudentId → handle", () => {
  it("NTNU student ID becomes handle without prefix", () => {
    expect(extractStudentId("ntnu", "41071234a")).toBe("41071234a");
  });

  it("NTU student ID gets ntu_ prefix", () => {
    expect(extractStudentId("ntu", "b12345678")).toBe("ntu_b12345678");
  });

  it("NTUST student ID gets ntust_ prefix", () => {
    expect(extractStudentId("ntust", "b12345678")).toBe("ntust_b12345678");
  });
});

describe("isStudentIdFormat", () => {
  it("matches NTNU format (8 digits + 1 letter)", () => {
    expect(isStudentIdFormat("41071234a")).toBe(true);
  });

  it("matches NTU/NTUST format (1 letter + 8 digits)", () => {
    expect(isStudentIdFormat("b12345678")).toBe(true);
  });

  it("rejects random string", () => {
    expect(isStudentIdFormat("john-doe")).toBe(false);
  });
});

describe("isReservedHandle", () => {
  it("rejects raw student ID format", () => {
    expect(isReservedHandle("41071234a")).toBe(true);
    expect(isReservedHandle("b12345678")).toBe(true);
  });

  it("rejects ntu_ prefixed handle", () => {
    expect(isReservedHandle("ntu_b12345678")).toBe(true);
  });

  it("rejects ntust_ prefixed handle", () => {
    expect(isReservedHandle("ntust_b12345678")).toBe(true);
  });

  it("rejects ntnu_ prefixed handle", () => {
    expect(isReservedHandle("ntnu_41071234a")).toBe(true);
  });

  it("allows normal handle", () => {
    expect(isReservedHandle("john-doe")).toBe(false);
  });

  it("allows handle starting with ntu but not matching pattern", () => {
    expect(isReservedHandle("ntu_lover")).toBe(false);
  });
});
