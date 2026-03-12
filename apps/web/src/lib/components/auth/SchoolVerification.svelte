<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { parseSchoolEmail } from "$lib/school";

  interface Props {
    isSchoolVerified: boolean;
  }

  let { isSchoolVerified }: Props = $props();

  type Phase = "idle" | "form" | "sent" | "verified";
  const RESEND_COOLDOWN = 60;

  let phase = $state<Phase>("idle");
  let schoolEmail = $state("");
  let error = $state("");
  let loading = $state(false);
  let cooldown = $state(0);

  // Countdown timer for resend cooldown
  $effect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => (cooldown -= 1), 1000);
    return () => clearTimeout(timer);
  });

  // Listen for BroadcastChannel verification
  $effect(() => {
    if (phase !== "sent") return;

    const bc = new BroadcastChannel("nojv-school-verify");
    bc.onmessage = (event: MessageEvent) => {
      if ((event.data as { type?: string }).type === "verified") {
        phase = "verified";
        setTimeout(() => {
          void invalidateAll();
        }, 1500);
      }
    };
    return () => bc.close();
  });

  function clientValidate(): boolean {
    error = "";
    const trimmed = schoolEmail.trim();
    if (!parseSchoolEmail(trimmed)) {
      error = m.account_invalidSchoolEmail();
      return false;
    }
    return true;
  }
</script>

{#if isSchoolVerified}
  <section
    class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-6 py-6"
  >
    <h3 class="text-sm font-medium">{m.account_schoolVerification()}</h3>
    <p class="mt-1 text-sm text-green-600">{m.account_schoolVerified()}</p>
  </section>
{:else}
  <section
    class="rounded-[2rem] border border-[color:var(--color-border)] bg-white/70 px-6 py-6"
  >
    <h3 class="text-sm font-medium">{m.account_schoolVerification()}</h3>
    <p class="mt-1 text-sm text-[color:var(--color-muted)]">
      {m.account_schoolVerificationDesc()}
    </p>

    {#if phase === "idle"}
      <button
        class="mt-3 rounded-lg border border-[color:var(--color-border)] px-4 py-2 text-sm font-medium transition hover:bg-white/70"
        onclick={() => (phase = "form")}
        type="button"
      >
        {m.account_startVerification()}
      </button>
    {/if}

    {#if phase === "form"}
      <form
        class="mt-3 flex flex-col gap-3"
        method="POST"
        action="?/sendVerification"
        use:enhance={({ cancel }) => {
          if (!clientValidate()) {
            cancel();
            return;
          }
          loading = true;
          return async ({ result, update }) => {
            loading = false;
            if (result.type === "success") {
              phase = "sent";
              cooldown = RESEND_COOLDOWN;
            } else if (result.type === "failure") {
              const data = result.data as { error?: string } | undefined;
              error = data?.error ?? "Failed to send verification email";
            } else {
              await update();
            }
          };
        }}
      >
        <label class="flex flex-col gap-1 text-sm">
          {m.account_schoolEmailLabel()}
          <input
            class="rounded-lg border border-[color:var(--color-border)] px-3 py-2"
            bind:value={schoolEmail}
            name="email"
            placeholder={m.account_schoolEmailPlaceholder()}
            required
            type="email"
          />
          <span class="text-xs text-[color:var(--color-muted)]">
            {m.account_acceptedDomains()}
          </span>
        </label>
        {#if error}
          <p class="text-sm text-red-600">{error}</p>
        {/if}
        <div class="flex gap-2">
          <button
            class="rounded-lg bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={loading}
            type="submit"
          >
            {loading ? m.account_sending() : m.account_sendVerification()}
          </button>
          <button
            class="rounded-lg border border-[color:var(--color-border)] px-4 py-2 text-sm font-medium transition hover:bg-white/70"
            onclick={() => {
              phase = "idle";
              error = "";
            }}
            type="button"
          >
            {m.common_cancel()}
          </button>
        </div>
      </form>
    {/if}

    {#if phase === "sent"}
      <div class="mt-3 flex flex-col gap-2">
        <p class="text-sm">{m.account_verificationSent()}</p>
        <form
          class="flex items-center gap-2"
          method="POST"
          action="?/sendVerification"
          use:enhance={() => {
            loading = true;
            return async ({ result, update }) => {
              loading = false;
              if (result.type === "success") {
                cooldown = RESEND_COOLDOWN;
              } else if (result.type === "failure") {
                const data = result.data as { error?: string } | undefined;
                error = data?.error ?? "Failed to send verification email";
              } else {
                await update();
              }
            };
          }}
        >
          <input type="hidden" name="email" value={schoolEmail} />
          <button
            class="rounded-lg border border-[color:var(--color-border)] px-4 py-2 text-sm font-medium transition hover:bg-white/70 disabled:opacity-50"
            disabled={cooldown > 0 || loading}
            type="submit"
          >
            {cooldown > 0
              ? m.account_resendCooldown({ seconds: cooldown })
              : m.account_resend()}
          </button>
          <button
            class="rounded-lg border border-[color:var(--color-border)] px-4 py-2 text-sm font-medium transition hover:bg-white/70"
            onclick={() => {
              phase = "form";
              error = "";
            }}
            type="button"
          >
            {m.account_changeEmail()}
          </button>
        </form>
        {#if error}
          <p class="text-sm text-red-600">{error}</p>
        {/if}
      </div>
    {/if}

    {#if phase === "verified"}
      <p class="mt-3 text-sm font-medium text-green-600">{m.account_verified()}</p>
    {/if}
  </section>
{/if}
