<script lang="ts">
  import { goto } from "$app/navigation";
  import { t } from "svelte-i18n";
  import { authClient } from "$lib/auth-client";
  import { HANDLE_INPUT_PATTERN, isValidHandle } from "$lib/auth-onboarding";
  import { isReservedHandle, parseSchoolEmail } from "$lib/school-verification";
  import { onMount } from "svelte";

  let { data } = $props();

  type Mode = "choose" | "school" | "general";

  let mode = $state<Mode>("choose");
  let error = $state("");
  let loading = $state(false);

  // School flow state
  let schoolEmail = $state("");
  let emailSent = $state(false);
  let verified = $state(false);

  // General flow state
  let handle = $state("");

  // BroadcastChannel listener
  onMount(() => {
    let bc: BroadcastChannel | undefined;

    const unwatch = $effect.root(() => {
      $effect(() => {
        if (mode !== "school" || !emailSent) return;

        bc = new BroadcastChannel("nojv-school-verify");
        bc.onmessage = (event: MessageEvent) => {
          if ((event.data as { type?: string }).type === "verified") {
            verified = true;
            setTimeout(() => {
              goto(`/${data.locale}`);
            }, 1500);
          }
        };

        return () => bc?.close();
      });
    });

    return () => {
      unwatch();
      bc?.close();
    };
  });

  async function handleSendVerification(event: SubmitEvent) {
    event.preventDefault();
    error = "";

    const trimmed = schoolEmail.trim();
    if (!parseSchoolEmail(trimmed)) {
      error = "\u8ACB\u8F38\u5165\u6709\u6548\u7684\u4E09\u6821 email\uFF08ntnu / ntu / ntust\uFF09";
      return;
    }

    loading = true;

    const res = await fetch("/api/auth/send-school-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: trimmed })
    });

    loading = false;

    if (!res.ok) {
      const resData = (await res.json()) as { error?: string };
      error = resData.error ?? "Failed to send verification email";
      return;
    }

    emailSent = true;
  }

  async function handleGeneralSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = "";

    const normalized = handle.trim().toLowerCase();

    if (!isValidHandle(normalized)) {
      error = "Use 3-64 lowercase letters, digits, dots, hyphens, or underscores.";
      return;
    }

    if (isReservedHandle(normalized)) {
      error = $t("onboarding.handleReserved");
      return;
    }

    loading = true;

    const { error: updateError } = await authClient.updateUser({
      username: normalized
    });

    loading = false;

    if (updateError) {
      error = updateError.message ?? "Failed to save handle.";
      return;
    }

    goto(`/${data.locale}`);
  }

  async function handleSignOut() {
    await authClient.signOut();
    goto(`/${data.locale}`);
  }
</script>

<div class="flex min-h-[60vh] items-center justify-center">
  <div
    class="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8 shadow-sm"
  >
    <h1 class="text-center text-2xl font-semibold">{$t("onboarding.title")}</h1>
    <p class="mt-2 text-center text-sm text-[color:var(--color-muted)]">
      {data.name} ({data.email})
    </p>

    {#if mode === "choose"}
      <div class="mt-6 flex flex-col gap-3">
        <p class="text-center text-sm text-[color:var(--color-muted)]">
          {$t("onboarding.subtitle")}
        </p>
        <button
          class="rounded-lg border border-[color:var(--color-border)] px-4 py-3 text-left transition hover:bg-white/70"
          onclick={() => (mode = "school")}
          type="button"
        >
          <p class="text-sm font-medium">{$t("onboarding.schoolOption")}</p>
          <p class="mt-0.5 text-xs text-[color:var(--color-muted)]">
            {$t("onboarding.schoolOptionDesc")}
          </p>
        </button>
        <button
          class="rounded-lg border border-[color:var(--color-border)] px-4 py-3 text-left transition hover:bg-white/70"
          onclick={() => (mode = "general")}
          type="button"
        >
          <p class="text-sm font-medium">{$t("onboarding.generalOption")}</p>
          <p class="mt-0.5 text-xs text-[color:var(--color-muted)]">
            {$t("onboarding.generalOptionDesc")}
          </p>
        </button>
        <button
          class="mt-2 rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
          onclick={() => void handleSignOut()}
          type="button"
        >
          {$t("onboarding.useOtherAccount")}
        </button>
      </div>
    {/if}

    {#if mode === "school"}
      <div class="mt-6">
        {#if verified}
          <p class="text-center text-sm font-medium text-green-600">
            {$t("onboarding.verified")}
          </p>
        {:else if emailSent}
          <div class="flex flex-col items-center gap-3">
            <div
              class="size-6 animate-spin rounded-full border-2 border-[color:var(--color-accent)] border-t-transparent"
            ></div>
            <p class="text-center text-sm text-[color:var(--color-muted)]">
              {$t("onboarding.verificationSent")}
            </p>
            <p class="text-center text-xs text-[color:var(--color-muted)]">
              {$t("onboarding.waitingVerification")}
            </p>
          </div>
        {:else}
          <form class="flex flex-col gap-4" onsubmit={handleSendVerification}>
            <label class="flex flex-col gap-1 text-sm">
              {$t("onboarding.schoolEmailLabel")}
              <input
                class="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
                oninput={(e) => (schoolEmail = (e.target as HTMLInputElement).value)}
                placeholder={$t("onboarding.schoolEmailPlaceholder")}
                required
                type="email"
                value={schoolEmail}
              />
            </label>
            {#if error}
              <p class="text-sm text-red-600">{error}</p>
            {/if}
            <button
              class="rounded-lg bg-[color:var(--color-accent)] py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={loading}
              type="submit"
            >
              {loading ? $t("onboarding.sending") : $t("onboarding.sendVerification")}
            </button>
            <button
              class="rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
              onclick={() => {
                mode = "choose";
                error = "";
              }}
              type="button"
            >
              {$t("onboarding.back")}
            </button>
          </form>
        {/if}
      </div>
    {/if}

    {#if mode === "general"}
      <form class="mt-6 flex flex-col gap-4" onsubmit={handleGeneralSubmit}>
        <label class="flex flex-col gap-1 text-sm">
          {$t("onboarding.handleLabel")}
          <input
            class="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
            maxlength={64}
            oninput={(e) => (handle = (e.target as HTMLInputElement).value)}
            pattern={HANDLE_INPUT_PATTERN}
            placeholder={$t("onboarding.handlePlaceholder")}
            required
            title="3-64 characters, lowercase letters, digits, dots, hyphens, underscores"
            type="text"
            value={handle}
          />
        </label>
        {#if error}
          <p class="text-sm text-red-600">{error}</p>
        {/if}
        <button
          class="rounded-lg bg-[color:var(--color-accent)] py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={loading}
          type="submit"
        >
          {loading ? $t("onboarding.saving") : $t("onboarding.continue")}
        </button>
        <button
          class="rounded-lg border border-[color:var(--color-border)] py-2 text-sm font-medium transition hover:bg-white/70"
          onclick={() => {
            mode = "choose";
            error = "";
          }}
          type="button"
        >
          {$t("onboarding.back")}
        </button>
      </form>
    {/if}
  </div>
</div>
