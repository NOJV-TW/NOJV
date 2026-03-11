"use client";

import { type SyntheticEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { HANDLE_INPUT_PATTERN, isValidHandle } from "@/lib/auth-onboarding";
import { isReservedHandle, parseSchoolEmail } from "@/lib/school-verification";
import { authClient } from "@/lib/auth-client";

interface CompleteProfileFormProps {
  email: string;
  locale: string;
  name: string;
}

type Mode = "choose" | "school" | "general";

export function CompleteProfileForm({ email, locale, name }: CompleteProfileFormProps) {
  const router = useRouter();
  const t = useTranslations("onboarding");
  const [mode, setMode] = useState<Mode>("choose");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // --- School flow state ---
  const [schoolEmail, setSchoolEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [verified, setVerified] = useState(false);

  // --- General flow state ---
  const [handle, setHandle] = useState("");

  // Listen for BroadcastChannel verification
  useEffect(() => {
    if (mode !== "school" || !emailSent) return;

    const bc = new BroadcastChannel("nojv-school-verify");
    bc.onmessage = (event: MessageEvent) => {
      if ((event.data as { type?: string }).type === "verified") {
        setVerified(true);
        // Small delay to show success, then redirect
        setTimeout(() => {
          router.push(`/${locale}`);
          router.refresh();
        }, 1500);
      }
    };
    return () => bc.close();
  }, [mode, emailSent, locale, router]);

  async function handleSendVerification(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
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

    setEmailSent(true);
  }

  async function handleGeneralSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const normalized = handle.trim().toLowerCase();

    if (!isValidHandle(normalized)) {
      setError("Use 3-64 lowercase letters, digits, dots, hyphens, or underscores.");
      return;
    }

    if (isReservedHandle(normalized)) {
      setError(t("handleReserved"));
      return;
    }

    setLoading(true);

    const { error: updateError } = await authClient.updateUser({
      username: normalized
    });

    setLoading(false);

    if (updateError) {
      setError(updateError.message ?? "Failed to save handle.");
      return;
    }

    router.push(`/${locale}`);
    router.refresh();
  }

  async function handleSignOut() {
    await authClient.signOut();
    router.push(`/${locale}`);
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8 shadow-sm">
      <h1 className="text-center text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-center text-sm text-[color:var(--color-muted)]">
        {name} ({email})
      </p>

      {mode === "choose" && (
        <div className="mt-6 flex flex-col gap-3">
          <p className="text-center text-sm text-[color:var(--color-muted)]">{t("subtitle")}</p>
          <button
            className="rounded-lg border border-[color:var(--color-border)] px-4 py-3 text-left transition hover:bg-white/70"
            onClick={() => setMode("school")}
            type="button"
          >
            <p className="text-sm font-medium">{t("schoolOption")}</p>
            <p className="mt-0.5 text-xs text-[color:var(--color-muted)]">
              {t("schoolOptionDesc")}
            </p>
          </button>
          <button
            className="rounded-lg border border-[color:var(--color-border)] px-4 py-3 text-left transition hover:bg-white/70"
            onClick={() => setMode("general")}
            type="button"
          >
            <p className="text-sm font-medium">{t("generalOption")}</p>
            <p className="mt-0.5 text-xs text-[color:var(--color-muted)]">
              {t("generalOptionDesc")}
            </p>
          </button>
          <button
            className="mt-2 rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
            onClick={() => void handleSignOut()}
            type="button"
          >
            {t("useOtherAccount")}
          </button>
        </div>
      )}

      {mode === "school" && (
        <div className="mt-6">
          {verified ? (
            <p className="text-center text-sm font-medium text-green-600">{t("verified")}</p>
          ) : emailSent ? (
            <div className="flex flex-col items-center gap-3">
              <div className="size-6 animate-spin rounded-full border-2 border-[color:var(--color-accent)] border-t-transparent" />
              <p className="text-center text-sm text-[color:var(--color-muted)]">
                {t("verificationSent")}
              </p>
              <p className="text-center text-xs text-[color:var(--color-muted)]">
                {t("waitingVerification")}
              </p>
            </div>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => void handleSendVerification(e)}
            >
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
              </label>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                className="rounded-lg bg-[color:var(--color-accent)] py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={loading}
                type="submit"
              >
                {loading ? t("sending") : t("sendVerification")}
              </button>
              <button
                className="rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
                onClick={() => {
                  setMode("choose");
                  setError("");
                }}
                type="button"
              >
                {t("back")}
              </button>
            </form>
          )}
        </div>
      )}

      {mode === "general" && (
        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={(e) => void handleGeneralSubmit(e)}
        >
          <label className="flex flex-col gap-1 text-sm">
            {t("handleLabel")}
            <input
              className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
              maxLength={64}
              onChange={(e) => setHandle(e.target.value)}
              pattern={HANDLE_INPUT_PATTERN}
              placeholder={t("handlePlaceholder")}
              required
              title="3-64 characters, lowercase letters, digits, dots, hyphens, underscores"
              type="text"
              value={handle}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            className="rounded-lg bg-[color:var(--color-accent)] py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={loading}
            type="submit"
          >
            {loading ? t("saving") : t("continue")}
          </button>
          <button
            className="rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
            onClick={() => {
              setMode("choose");
              setError("");
            }}
            type="button"
          >
            {t("back")}
          </button>
        </form>
      )}
    </div>
  );
}
