import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { createTransport: vi.fn(() => ({ sendMail })), sendMail };
});

vi.mock("nodemailer", () => ({ default: { createTransport } }));

const MAILER_ENV_KEYS = [
  "NODE_ENV",
  "MAILER_MODE",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "SMTP_TYPO",
  "APP_BASE_URL",
] as const;
let saved: Record<(typeof MAILER_ENV_KEYS)[number], string | undefined>;

async function importMailer() {
  vi.resetModules();
  return import("@nojv/mailer");
}

function useSinkEnv(nodeEnv: "development" | "test" = "test"): void {
  process.env.NODE_ENV = nodeEnv;
  process.env.MAILER_MODE = "sink";
  process.env.APP_BASE_URL = "http://localhost:5173";
}

function useSmtpEnv(port = "465", nodeEnv: "development" | "test" | "production" = "test") {
  process.env.NODE_ENV = nodeEnv;
  process.env.MAILER_MODE = "smtp";
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = port;
  process.env.SMTP_USER = "user@example.com";
  process.env.SMTP_PASS = "pw";
  process.env.SMTP_FROM = "NOJV <no-reply@example.com>";
  process.env.APP_BASE_URL =
    nodeEnv === "production" ? "https://nojv.tw" : "http://localhost:5173";
}

beforeEach(() => {
  saved = Object.fromEntries(
    MAILER_ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as typeof saved;
  for (const key of MAILER_ENV_KEYS) delete process.env[key];
  createTransport.mockClear();
  sendMail.mockReset().mockResolvedValue({ accepted: ["a@b.c"], rejected: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of MAILER_ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("mailer configuration", () => {
  it("requires an explicit MAILER_MODE", async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_BASE_URL = "http://localhost:5173";
    const { validateMailerConfig } = await importMailer();
    expect(() => validateMailerConfig()).toThrow();
  });

  it.each(["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const)(
    "requires %s in smtp mode",
    async (key) => {
      useSmtpEnv();
      delete process.env[key];
      const { validateMailerConfig } = await importMailer();
      expect(() => validateMailerConfig()).toThrow();
    },
  );

  it("requires HTTPS APP_BASE_URL for production SMTP", async () => {
    useSmtpEnv("465", "production");
    process.env.APP_BASE_URL = "http://nojv.example.com";
    const { validateMailerConfig } = await importMailer();
    expect(() => validateMailerConfig()).toThrow(/HTTPS/i);
  });

  it("allows sink only in development and test", async () => {
    process.env.NODE_ENV = "production";
    process.env.MAILER_MODE = "sink";
    process.env.APP_BASE_URL = "https://nojv.example.com";
    const { validateMailerConfig } = await importMailer();
    expect(() => validateMailerConfig()).toThrow();
  });

  it.each(["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const)(
    "rejects stray %s in sink mode",
    async (key) => {
      useSinkEnv();
      process.env[key] = key === "SMTP_PORT" ? "465" : "stray";
      const { validateMailerConfig } = await importMailer();
      expect(() => validateMailerConfig()).toThrow();
    },
  );

  it.each(["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const)(
    "rejects empty stray %s in sink mode",
    async (key) => {
      useSinkEnv();
      process.env[key] = "";
      const { validateMailerConfig } = await importMailer();
      expect(() => validateMailerConfig()).toThrow();
    },
  );

  it("rejects unknown SMTP variables in sink mode", async () => {
    useSinkEnv();
    process.env.SMTP_TYPO = "stray";
    const { validateMailerConfig } = await importMailer();
    expect(() => validateMailerConfig()).toThrow();
  });
});

describe("getMailer", () => {
  it("returns suppressed in sink mode and logs no message content", async () => {
    useSinkEnv();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { getMailer } = await importMailer();

    await expect(
      getMailer().sendEmail({
        to: "secret-recipient@example.com",
        subject: "secret subject",
        html: "<p>OTP 123456</p>",
        messageId: "<secret@nojv.local>",
      }),
    ).resolves.toBe("suppressed");

    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith({
      component: "mailer",
      event: "email_suppressed",
      mode: "sink",
    });
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain("secret-recipient");
    expect(logged).not.toContain("secret subject");
    expect(logged).not.toContain("123456");
  });

  it("builds a TLS-required SMTP transport and reports accepted delivery", async () => {
    useSmtpEnv();
    const { getMailer } = await importMailer();

    await expect(
      getMailer().sendEmail({
        to: "a@b.c",
        subject: "hi",
        html: "<p>h</p>",
        messageId: "<test@nojv.local>",
      }),
    ).resolves.toBe("accepted");

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      requireTLS: true,
      auth: { user: "user@example.com", pass: "pw" },
      pool: true,
      maxConnections: 3,
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: "NOJV <no-reply@example.com>",
      to: "a@b.c",
      subject: "hi",
      html: "<p>h</p>",
      messageId: "<test@nojv.local>",
    });
  });

  it("uses STARTTLS for port 587", async () => {
    useSmtpEnv("587");
    const { getMailer } = await importMailer();
    await getMailer().sendEmail({
      to: "a@b.c",
      subject: "hi",
      html: "<p>h</p>",
      messageId: "<test@nojv.local>",
    });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false, requireTLS: true }),
    );
  });

  it("rejects an SMTP response that accepted no recipients", async () => {
    useSmtpEnv();
    sendMail.mockResolvedValueOnce({ accepted: [], rejected: ["a@b.c"] });
    const { getMailer } = await importMailer();
    await expect(
      getMailer().sendEmail({
        to: "a@b.c",
        subject: "hi",
        html: "<p>h</p>",
        messageId: "<test@nojv.local>",
      }),
    ).rejects.toThrow(/accepted no recipients/i);
  });

  it("propagates SMTP runtime errors without falling back to sink", async () => {
    useSmtpEnv();
    const smtpError = new Error("smtp down");
    sendMail.mockRejectedValueOnce(smtpError);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { getMailer } = await importMailer();
    await expect(
      getMailer().sendEmail({
        to: "a@b.c",
        subject: "hi",
        html: "<p>h</p>",
        messageId: "<test@nojv.local>",
      }),
    ).rejects.toBe(smtpError);
    expect(info).not.toHaveBeenCalled();
  });

  it("memoizes the mailer across calls", async () => {
    useSmtpEnv();
    const { getMailer } = await importMailer();
    expect(getMailer()).toBe(getMailer());
    expect(createTransport).toHaveBeenCalledTimes(1);
  });
});
