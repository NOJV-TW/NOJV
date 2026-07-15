import { beforeEach, describe, expect, it, vi } from "vitest";

const { initiateSchoolVerification, sendEmail, loggerError } = vi.hoisted(() => ({
  initiateSchoolVerification: vi.fn(),
  sendEmail: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@nojv/application", () => ({
  userDomain: { initiateSchoolVerification },
}));

vi.mock("@nojv/mailer", () => ({
  getAppBaseUrl: () => "https://app.nojv.test",
  getMailer: () => ({ sendEmail }),
  renderEmail: (content: unknown) => JSON.stringify(content),
}));

vi.mock("$lib/server/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerError,
  }),
}));

vi.mock("$lib/server/shared/rate-limiter", () => ({
  consumeFormRateLimitInternal: vi.fn().mockResolvedValue(null),
}));

import { processSchoolVerification } from "$lib/server/shared/school-verification";

beforeEach(() => {
  vi.clearAllMocks();
  initiateSchoolVerification.mockResolvedValue({ status: "success", token: "token-123" });
  sendEmail.mockResolvedValue("accepted");
});

describe("processSchoolVerification email delivery", () => {
  it("reports success only after SMTP accepts the message", async () => {
    const result = await processSchoolVerification("user-1", "41047000s@ntnu.edu.tw");
    expect(result).toEqual({ success: true });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "41047000s@ntnu.edu.tw",
        html: expect.stringContaining("https://app.nojv.test/verify-school?token=token-123"),
      }),
    );
  });

  it("does not report success when delivery is suppressed", async () => {
    sendEmail.mockResolvedValue("suppressed");
    const result = await processSchoolVerification("user-1", "41047000s@ntnu.edu.tw");
    expect(result).toEqual({ error: "Email delivery is unavailable", status: 503 });
  });

  it("does not report success when SMTP fails", async () => {
    sendEmail.mockRejectedValue(new Error("smtp down"));
    const result = await processSchoolVerification("user-1", "41047000s@ntnu.edu.tw");
    expect(result).toEqual({ error: "Failed to send email", status: 500 });
    expect(loggerError).toHaveBeenCalledWith("email send failed", { err: "smtp down" });
  });
});
