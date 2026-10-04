import { describe, expect, it, vi } from "vitest";

vi.mock("$app/forms", () => ({ deserialize: (text: string): unknown => JSON.parse(text) }));

import { formlessResultMessage } from "$lib/utils/actions";

describe("formlessResultMessage", () => {
  it("surfaces a failure that carries no validation form", () => {
    expect(
      formlessResultMessage({
        type: "failure",
        status: 429,
        data: { error: "Too many requests. Please try again later." },
      }),
    ).toBe("Too many requests. Please try again later.");
  });

  it("surfaces error results", () => {
    expect(
      formlessResultMessage({ type: "error", status: 500, error: { message: "Boom" } }),
    ).toBe("Boom");
  });

  it("leaves results that carry a form to superforms", () => {
    const form = { id: "f", valid: false, posted: true, data: {}, errors: {} };
    expect(formlessResultMessage({ type: "failure", status: 400, data: { form } })).toBeNull();
    expect(formlessResultMessage({ type: "success", status: 200, data: { form } })).toBeNull();
    expect(formlessResultMessage({ type: "redirect", status: 303, location: "/" })).toBeNull();
  });
});
