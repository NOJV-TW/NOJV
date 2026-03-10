"use client";

import { type SyntheticEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { HANDLE_INPUT_PATTERN, isValidHandle } from "@/lib/auth-onboarding";
import { authClient } from "@/lib/auth-client";

interface CompleteProfileFormProps {
  email: string;
  locale: string;
  name: string;
}

export function CompleteProfileForm({ email, locale, name }: CompleteProfileFormProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedHandle = handle.trim();

    if (!isValidHandle(normalizedHandle)) {
      setError("Use 3-64 lowercase letters, digits, dots, hyphens, or underscores.");
      return;
    }

    setError("");
    setLoading(true);

    const { error: updateError } = await authClient.updateUser({
      username: normalizedHandle
    });

    setLoading(false);

    if (updateError) {
      setError(updateError.message ?? "Failed to save your handle.");
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
      <h1 className="text-center text-2xl font-semibold">Finish your NOJV profile</h1>
      <p className="mt-3 text-center text-sm text-[color:var(--color-muted)]">
        {name} ({email}). Set your unique NOJV handle before continuing.
      </p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <label className="flex flex-col gap-1 text-sm">
          NOJV handle
          <input
            className="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
            maxLength={64}
            name="handle"
            onChange={(event) => setHandle(event.target.value)}
            pattern={HANDLE_INPUT_PATTERN}
            placeholder="e.g. john-doe"
            required
            title="3-64 characters, lowercase letters, digits, dots, hyphens, underscores"
            type="text"
            value={handle}
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          className="rounded-lg bg-[color:var(--color-accent)] py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={loading}
          type="submit"
        >
          {loading ? "Saving..." : "Continue"}
        </button>
        <button
          className="rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
          onClick={() => void handleSignOut()}
          type="button"
        >
          Use a different account
        </button>
      </form>
    </div>
  );
}
