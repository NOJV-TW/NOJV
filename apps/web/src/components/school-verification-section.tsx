"use client";

import { type SyntheticEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { shellClassNames } from "@nojv/ui";

import { parseSchoolEmail } from "@/lib/school-verification";

interface SchoolVerificationSectionProps {
  isSchoolVerified: boolean;
}

type Phase = "idle" | "form" | "sent" | "verified";

const RESEND_COOLDOWN = 60;

export function SchoolVerificationSection({
  isSchoolVerified
}: SchoolVerificationSectionProps) {
  const router = useRouter();
  const t = useTranslations("account");
  const [phase, setPhase] = useState<Phase>("idle");
  const [schoolEmail, setSchoolEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Countdown timer for resend cooldown
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // Listen for BroadcastChannel verification
  useEffect(() => {
    if (phase !== "sent") return;

    const bc = new BroadcastChannel("nojv-school-verify");
    bc.onmessage = (event: MessageEvent) => {
      if ((event.data as { type?: string }).type === "verified") {
        setPhase("verified");
        setTimeout(() => {
          router.refresh();
        }, 1500);
      }
    };
    return () => bc.close();
  }, [phase, router]);

  const sendVerification = useCallback(async () => {
    setError("");

    const trimmed = schoolEmail.trim();
    if (!parseSchoolEmail(trimmed)) {
      setError("請輸入有效的三校 email（ntnu / ntu / ntust）");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/auth/send-school-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: trimmed })
    });

    setLoading(false);

    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Failed to send verification email");
      return;
    }

    setPhase("sent");
    setCooldown(RESEND_COOLDOWN);
  }, [schoolEmail]);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendVerification();
  }

  if (isSchoolVerified) {
    return (
      <section className={`${shellClassNames.card} px-6 py-6`}>
        <h3 className="text-sm font-medium">{t("schoolVerification")}</h3>
        <p className="mt-1 text-sm text-green-600">{t("schoolVerified")}</p>
      </section>
    );
  }

  return (
    <section className={`${shellClassNames.card} px-6 py-6`}>
      <h3 className="text-sm font-medium">{t("schoolVerification")}</h3>
      <p className="mt-1 text-sm text-[color:var(--color-muted)]">
        {t("schoolVerificationDesc")}
      </p>

      {phase === "idle" && (
        <button
          className="mt-3 rounded-lg border border-[color:var(--color-border)] px-4 py-2 text-sm font-medium transition hover:bg-white/70"
          onClick={() => setPhase("form")}
          type="button"
        >
          {t("startVerification")}
        </button>
      )}

      {phase === "form" && (
        <form className="mt-3 flex flex-col gap-3" onSubmit={(e) => void handleSubmit(e)}>
          <label className="flex flex-col gap-1 text-sm">
            {t("schoolEmailLabel")}
            <input
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
              onChange={(e) => setSchoolEmail(e.target.value)}
              placeholder={t("schoolEmailPlaceholder")}
              required
              type="email"
              value={schoolEmail}
            />
            <span className="text-xs text-[color:var(--color-muted)]">
              {t("acceptedDomains")}
            </span>
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              className="rounded-lg bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={loading}
              type="submit"
            >
              {loading ? t("sending") : t("sendVerification")}
            </button>
            <button
              className="rounded-lg border border-[color:var(--color-border)] px-4 py-2 text-sm font-medium transition hover:bg-white/70"
              onClick={() => {
                setPhase("idle");
                setError("");
              }}
              type="button"
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      )}

      {phase === "sent" && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm">{t("verificationSent")}</p>
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg border border-[color:var(--color-border)] px-4 py-2 text-sm font-medium transition hover:bg-white/70 disabled:opacity-50"
              disabled={cooldown > 0 || loading}
              onClick={() => void sendVerification()}
              type="button"
            >
              {cooldown > 0 ? t("resendCooldown", { seconds: cooldown }) : t("resend")}
            </button>
            <button
              className="rounded-lg border border-[color:var(--color-border)] px-4 py-2 text-sm font-medium transition hover:bg-white/70"
              onClick={() => {
                setPhase("form");
                setError("");
              }}
              type="button"
            >
              {t("changeEmail")}
            </button>
          </div>
        </div>
      )}

      {phase === "verified" && (
        <p className="mt-3 text-sm font-medium text-green-600">{t("verified")}</p>
      )}
    </section>
  );
}
