import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn().mockResolvedValue(undefined);
  return { createTransport: vi.fn(() => ({ sendMail })), sendMail };
});

vi.mock("nodemailer", () => ({ default: { createTransport } }));

const SMTP_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const;
let saved: Record<string, string | undefined>;

async function importMailer() {
  vi.resetModules();
  return import("@nojv/mailer");
}

beforeEach(() => {
  saved = Object.fromEntries(SMTP_KEYS.map((k) => [k, process.env[k]]));
  for (const k of SMTP_KEYS) delete process.env[k];
  createTransport.mockClear();
  sendMail.mockClear();
});

afterEach(() => {
  for (const k of SMTP_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getMailer", () => {
  it("returns a no-op mailer when SMTP is unconfigured", async () => {
    const { getMailer } = await importMailer();
    const mailer = getMailer();
    await expect(
      mailer.sendEmail({ to: "a@b.c", subject: "s", html: "<p>h</p>" }),
    ).resolves.toBeUndefined();
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("returns a no-op mailer when only SMTP_HOST is set", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    const { getMailer } = await importMailer();
    await getMailer().sendEmail({ to: "a@b.c", subject: "s", html: "<p>h</p>" });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("builds a secure nodemailer transport when SMTP is configured", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "user@example.com";
    process.env.SMTP_PASS = "pw";
    const { getMailer } = await importMailer();
    await getMailer().sendEmail({ to: "a@b.c", subject: "hi", html: "<p>h</p>" });
    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "user@example.com", pass: "pw" },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: "NOJV <user@example.com>",
      to: "a@b.c",
      subject: "hi",
      html: "<p>h</p>",
    });
  });

  it("uses SMTP_FROM as the sender and a plain transport for port 587", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user@example.com";
    process.env.SMTP_PASS = "pw";
    process.env.SMTP_FROM = "NOJV <no-reply@nojv.tw>";
    const { getMailer } = await importMailer();
    await getMailer().sendEmail({ to: "a@b.c", subject: "hi", html: "<p>h</p>" });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: "NOJV <no-reply@nojv.tw>" }),
    );
  });

  it("memoizes the mailer across calls", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "user@example.com";
    process.env.SMTP_PASS = "pw";
    const { getMailer } = await importMailer();
    const first = getMailer();
    const second = getMailer();
    expect(first).toBe(second);
    expect(createTransport).toHaveBeenCalledTimes(1);
  });
});
