import { describe, expect, it } from "vitest";

import { generatePassword } from "../../../packages/application/src/exam/credentials";

describe("exam password generator", () => {
  it("produces 8 letters and digits without look-alike characters", () => {
    const passwords = Array.from({ length: 2000 }, generatePassword);

    for (const password of passwords) {
      expect(password).toMatch(/^[A-Za-z0-9]{8}$/);
      expect(password).not.toMatch(/[0Oo1lI]/);
    }
    expect(new Set(passwords.join("")).size).toBe(56);
  });
});
