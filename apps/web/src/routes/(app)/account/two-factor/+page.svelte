<script lang="ts">
  import QRCode from "qrcode";
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { authClient } from "$lib/auth.client";
  import Section from "$lib/components/primitives/ui/Section.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import { toasts } from "$lib/stores/toast";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  let phase = $state<"idle" | "setup">("idle");
  let password = $state("");
  let code = $state("");
  let error = $state("");
  let busy = $state(false);
  let qrDataUrl = $state("");
  let manualKey = $state("");
  let backupCodes = $state<string[]>([]);

  function secretFromUri(uri: string): string {
    try {
      return new URL(uri).searchParams.get("secret") ?? "";
    } catch {
      return "";
    }
  }

  async function enable() {
    error = "";
    busy = true;
    const { data: result, error: err } = await authClient.twoFactor.enable({ password });
    busy = false;
    if (err || !result) {
      error = err?.message ?? m.account_2fa_errorGeneric();
      return;
    }
    backupCodes = result.backupCodes ?? [];
    manualKey = secretFromUri(result.totpURI);
    qrDataUrl = await QRCode.toDataURL(result.totpURI);
    phase = "setup";
  }

  async function verify() {
    error = "";
    busy = true;
    const { error: err } = await authClient.twoFactor.verifyTotp({ code });
    busy = false;
    if (err) {
      error = err.message ?? m.account_2fa_errorGeneric();
      return;
    }
    toasts.success(m.account_2fa_enabledDone());
    password = "";
    code = "";
    phase = "idle";
    await invalidateAll();
  }

  async function disable() {
    error = "";
    busy = true;
    const { error: err } = await authClient.twoFactor.disable({ password });
    busy = false;
    if (err) {
      error = err.message ?? m.account_2fa_errorGeneric();
      return;
    }
    toasts.success(m.account_2fa_disabledDone());
    password = "";
    await invalidateAll();
  }

  async function regenerate() {
    error = "";
    busy = true;
    const { data: result, error: err } = await authClient.twoFactor.generateBackupCodes({
      password,
    });
    busy = false;
    if (err || !result) {
      error = err?.message ?? m.account_2fa_errorGeneric();
      return;
    }
    backupCodes = result.backupCodes ?? [];
    password = "";
  }

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
  const btnClass =
    "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-body-sm font-medium text-primary-foreground transition-colors duration-fast ease-out-soft hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
</script>

<PageContainer width="form">
  <Section>
    {#snippet header()}
      <h1 class="text-title-lg">{m.account_2fa_title()}</h1>
      <p>{m.account_2fa_description()}</p>
    {/snippet}

    <Card variant="surface" size="md">
      {#if data.platformRole === "admin" && !data.twoFactorEnabled}
        <p
          class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-body-sm text-warning-foreground"
        >
          {m.account_2fa_adminRequired()}
        </p>
      {/if}

      {#if error}
        <p class="text-caption text-destructive">{error}</p>
      {/if}

      {#if data.twoFactorEnabled}
        <p class="text-body-sm">{m.account_2fa_enabledNotice()}</p>
        <label class="flex flex-col gap-1.5">
          <span class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.account_2fa_passwordLabel()}
          </span>
          <input
            type="password"
            autocomplete="current-password"
            bind:value={password}
            class={inputClass}
          />
        </label>
        <div class="flex flex-wrap gap-2">
          <button type="button" class={btnClass} disabled={busy || !password} onclick={disable}>
            {m.account_2fa_disable()}
          </button>
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-body-sm font-medium transition-colors duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || !password}
            onclick={regenerate}
          >
            {m.account_2fa_regenerate()}
          </button>
        </div>
      {:else if phase === "idle"}
        <label class="flex flex-col gap-1.5">
          <span class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.account_2fa_passwordLabel()}
          </span>
          <input
            type="password"
            autocomplete="current-password"
            bind:value={password}
            class={inputClass}
          />
        </label>
        <button type="button" class={btnClass} disabled={busy || !password} onclick={enable}>
          {m.account_2fa_enable()}
        </button>
      {:else}
        <p class="text-body-sm">{m.account_2fa_scanInstruction()}</p>
        {#if qrDataUrl}
          <img
            src={qrDataUrl}
            alt="TOTP QR code"
            class="h-44 w-44 rounded-md border border-border"
          />
        {/if}
        {#if manualKey}
          <div class="flex flex-col gap-1">
            <span class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.account_2fa_manualKey()}
            </span>
            <code class="break-all rounded bg-muted px-2 py-1 text-body-sm">{manualKey}</code>
          </div>
        {/if}
        {#if backupCodes.length > 0}
          <div class="flex flex-col gap-1">
            <span class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.account_2fa_backupTitle()}
            </span>
            <p class="text-caption text-muted-foreground">
              {m.account_2fa_backupInstruction()}
            </p>
            <ul class="grid grid-cols-2 gap-1 font-mono text-body-sm">
              {#each backupCodes as bc (bc)}
                <li class="rounded bg-muted px-2 py-1">{bc}</li>
              {/each}
            </ul>
          </div>
        {/if}
        <label class="flex flex-col gap-1.5">
          <span class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.account_2fa_codeLabel()}
          </span>
          <input
            inputmode="numeric"
            autocomplete="one-time-code"
            bind:value={code}
            class={inputClass}
          />
        </label>
        <button
          type="button"
          class={btnClass}
          disabled={busy || code.length < 6}
          onclick={verify}
        >
          {m.account_2fa_verify()}
        </button>
      {/if}
    </Card>
  </Section>
</PageContainer>
