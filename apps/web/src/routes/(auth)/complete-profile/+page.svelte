<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { authClient } from "$lib/auth-client";
  import { actionErrorSchema, broadcastVerifiedSchema } from "@nojv/core";
  import { HANDLE_INPUT_PATTERN, isValidHandle } from "$lib/utils";

  import { isReservedHandle, parseSchoolEmail } from "$lib/school";
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
          if (broadcastVerifiedSchema.safeParse(event.data).success) {
            verified = true;
            setTimeout(() => {
              goto("/");
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

  function clientValidateSchoolEmail(): boolean {
    error = "";
    const trimmed = schoolEmail.trim();
    if (!parseSchoolEmail(trimmed)) {
      error = m.auth_invalidSchoolEmail();
      return false;
    }
    return true;
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
      error = m.onboarding_handleReserved();
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

    goto("/");
  }

  async function handleSignOut() {
    await authClient.signOut();
    goto("/");
  }
</script>

<div class="flex min-h-[60vh] items-center justify-center">
  <div
    class="w-full max-w-sm rounded-[2rem] border border-border bg-[color:var(--color-panel)] p-8 shadow-sm backdrop-blur-sm"
  >
    <h1 class="text-center text-2xl font-semibold">{m.onboarding_title()}</h1>
    <p class="mt-2 text-center text-sm text-muted-foreground">
      {data.name} ({data.email})
    </p>

    {#if mode === "choose"}
      <div class="mt-6 flex flex-col gap-3">
        <p class="text-center text-sm text-muted-foreground">
          {m.onboarding_subtitle()}
        </p>
        <button
          class="rounded-2xl border border-border px-4 py-3 text-left transition hover:-translate-y-0.5 hover:bg-white/60"
          onclick={() => (mode = "school")}
          type="button"
        >
          <p class="text-sm font-medium">{m.onboarding_schoolOption()}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            {m.onboarding_schoolOptionDesc()}
          </p>
        </button>
        <button
          class="rounded-2xl border border-border px-4 py-3 text-left transition hover:-translate-y-0.5 hover:bg-white/60"
          onclick={() => (mode = "general")}
          type="button"
        >
          <p class="text-sm font-medium">{m.onboarding_generalOption()}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            {m.onboarding_generalOptionDesc()}
          </p>
        </button>
        <button
          class="mt-2 rounded-full border border-border py-2 text-sm font-medium transition hover:-translate-y-0.5 hover:bg-white/60"
          onclick={() => void handleSignOut()}
          type="button"
        >
          {m.onboarding_useOtherAccount()}
        </button>
      </div>
    {/if}

    {#if mode === "school"}
      <div class="mt-6">
        {#if verified}
          <p class="text-center text-sm font-medium text-green-600">
            {m.onboarding_verified()}
          </p>
        {:else if emailSent}
          <div class="flex flex-col items-center gap-3">
            <div
              class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
            ></div>
            <p class="text-center text-sm text-muted-foreground">
              {m.onboarding_verificationSent()}
            </p>
            <p class="text-center text-xs text-muted-foreground">
              {m.onboarding_waitingVerification()}
            </p>
          </div>
        {:else}
          <form
            class="flex flex-col gap-4"
            method="POST"
            action="?/sendVerification"
            use:enhance={({ cancel }) => {
              if (!clientValidateSchoolEmail()) {
                cancel();
                return;
              }
              loading = true;
              return async ({ result, update }) => {
                loading = false;
                if (result.type === "success") {
                  emailSent = true;
                } else if (result.type === "failure") {
                  const parsed = actionErrorSchema.safeParse(result.data);
                  error = parsed.success ? parsed.data.error : "Failed to send verification email";
                } else {
                  await update();
                }
              };
            }}
          >
            <label class="flex flex-col gap-1 text-sm">
              {m.onboarding_schoolEmailLabel()}
              <input
                class="rounded-2xl border border-border bg-white/60 px-3 py-3"
                name="email"
                oninput={(e) => (schoolEmail = (e.target as HTMLInputElement).value)}
                placeholder={m.onboarding_schoolEmailPlaceholder()}
                required
                type="email"
                value={schoolEmail}
              />
            </label>
            {#if error}
              <p class="text-sm text-red-600">{error}</p>
            {/if}
            <button
              class="rounded-full bg-primary py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-50"
              disabled={loading}
              type="submit"
            >
              {loading ? m.onboarding_sending() : m.onboarding_sendVerification()}
            </button>
            <button
              class="rounded-full border border-border py-2 text-sm font-medium transition hover:-translate-y-0.5 hover:bg-white/60"
              onclick={() => {
                mode = "choose";
                error = "";
              }}
              type="button"
            >
              {m.onboarding_back()}
            </button>
          </form>
        {/if}
      </div>
    {/if}

    {#if mode === "general"}
      <form class="mt-6 flex flex-col gap-4" onsubmit={handleGeneralSubmit}>
        <label class="flex flex-col gap-1 text-sm">
          {m.onboarding_handleLabel()}
          <input
            class="rounded-2xl border border-border bg-white/60 px-3 py-3"
            maxlength={64}
            oninput={(e) => (handle = (e.target as HTMLInputElement).value)}
            pattern={HANDLE_INPUT_PATTERN}
            placeholder={m.onboarding_handlePlaceholder()}
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
          class="rounded-full bg-primary py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-50"
          disabled={loading}
          type="submit"
        >
          {loading ? m.onboarding_saving() : m.onboarding_continue()}
        </button>
        <button
          class="rounded-full border border-border py-2 text-sm font-medium transition hover:-translate-y-0.5 hover:bg-white/60"
          onclick={() => {
            mode = "choose";
            error = "";
          }}
          type="button"
        >
          {m.onboarding_back()}
        </button>
      </form>
    {/if}
  </div>
</div>
