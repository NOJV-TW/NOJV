<script lang="ts">
  import QRCode from "qrcode";
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import Section from "$lib/components/primitives/ui/Section.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import { toasts } from "$lib/stores/toast";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  let phase = $state<"idle" | "linkSent" | "setup">(data.enrollConfirmed ? "linkSent" : "idle");
  let code = $state("");
  let password = $state("");
  let manageCode = $state("");
  let managePassword = $state("");
  let error = $state("");
  let needsReauth = $state(false);
  let busy = $state(false);
  let qrDataUrl = $state("");
  let manualKey = $state("");
  let backupCodes = $state<string[]>([]);
  let savedBackupCodes = $state(false);

  function secretFromUri(uri: string): string {
    try {
      return new URL(uri).searchParams.get("secret") ?? "";
    } catch {
      return "";
    }
  }

  function reset() {
    error = "";
    needsReauth = false;
  }

  const manageReady = $derived(
    data.hasPassword ? managePassword.length > 0 : manageCode.length >= 6,
  );

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
  const btnClass =
    "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-body-sm font-medium text-primary-foreground transition-colors duration-fast ease-out-soft hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
  const secondaryBtnClass =
    "inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-body-sm font-medium transition-colors duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";
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

      {#if needsReauth}
        <p
          class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-body-sm text-warning-foreground"
        >
          {m.account_2fa_needsReauth()}
        </p>
      {/if}

      {#if error}
        <p class="text-caption text-destructive" role="alert">{error}</p>
      {/if}

      {#if data.twoFactorEnabled}
        <p class="text-body-sm">{m.account_2fa_enabledNotice()}</p>
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
            {data.hasPassword ? m.account_2fa_passwordLabel() : m.account_2fa_manageCodeLabel()}
          </span>
          {#if data.hasPassword}
            <input
              type="password"
              autocomplete="current-password"
              bind:value={managePassword}
              class={inputClass}
            />
          {:else}
            <input
              inputmode="numeric"
              autocomplete="one-time-code"
              bind:value={manageCode}
              class={inputClass}
            />
          {/if}
        </label>
        <div class="flex flex-wrap gap-2">
          <form
            method="POST"
            action="?/disable"
            use:enhance={() => {
              reset();
              busy = true;
              return async ({ result }) => {
                busy = false;
                if (result.type === "failure") {
                  error = (result.data?.error as string) ?? m.account_2fa_errorGeneric();
                  return;
                }
                if (result.type === "success") {
                  toasts.success(m.account_2fa_disabledDone());
                  backupCodes = [];
                  managePassword = "";
                  manageCode = "";
                  await invalidateAll();
                }
              };
            }}
          >
            <input type="hidden" name="password" value={managePassword} />
            <input type="hidden" name="code" value={manageCode} />
            <button type="submit" class={btnClass} disabled={busy || !manageReady}>
              {m.account_2fa_disable()}
            </button>
          </form>
          <form
            method="POST"
            action="?/regenerate"
            use:enhance={() => {
              reset();
              busy = true;
              return async ({ result }) => {
                busy = false;
                if (result.type === "failure") {
                  error = (result.data?.error as string) ?? m.account_2fa_errorGeneric();
                  return;
                }
                if (result.type === "success" && result.data) {
                  backupCodes = (result.data.backupCodes as string[]) ?? [];
                  managePassword = "";
                  manageCode = "";
                }
              };
            }}
          >
            <input type="hidden" name="password" value={managePassword} />
            <input type="hidden" name="code" value={manageCode} />
            <button type="submit" class={secondaryBtnClass} disabled={busy || !manageReady}>
              {m.account_2fa_regenerate()}
            </button>
          </form>
        </div>
      {:else if data.hasPassword && phase === "idle"}
        <p class="text-body-sm">{m.account_2fa_passwordIntro()}</p>
        <form
          class="flex flex-col gap-3"
          method="POST"
          action="?/enable"
          use:enhance={() => {
            reset();
            busy = true;
            return async ({ result }) => {
              busy = false;
              if (result.type === "failure") {
                needsReauth = result.data?.needsReauth === true;
                error = needsReauth ? "" : ((result.data?.error as string) ?? "");
                return;
              }
              if (result.type === "success" && result.data) {
                const totpURI = result.data.totpURI as string;
                backupCodes = (result.data.backupCodes as string[]) ?? [];
                manualKey = secretFromUri(totpURI);
                qrDataUrl = await QRCode.toDataURL(totpURI);
                password = "";
                phase = "setup";
              }
            };
          }}
        >
          <label class="flex flex-col gap-1.5">
            <span class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.account_2fa_passwordLabel()}
            </span>
            <input
              name="password"
              type="password"
              autocomplete="current-password"
              bind:value={password}
              class={inputClass}
            />
          </label>
          <button type="submit" class={btnClass} disabled={busy || password.length === 0}>
            {m.account_2fa_enable()}
          </button>
        </form>
      {:else if phase === "idle"}
        <p class="text-body-sm">{m.account_2fa_otpIntro()}</p>
        <form
          method="POST"
          action="?/sendConfirm"
          use:enhance={() => {
            reset();
            busy = true;
            return async ({ result }) => {
              busy = false;
              if (result.type === "failure") {
                needsReauth = result.data?.needsReauth === true;
                error = needsReauth ? "" : ((result.data?.error as string) ?? "");
                return;
              }
              if (result.type === "success") {
                phase = "linkSent";
                toasts.success(m.account_2fa_otpSent());
              }
            };
          }}
        >
          <button type="submit" class={btnClass} disabled={busy}>
            {m.account_2fa_sendOtp()}
          </button>
        </form>
      {:else if phase === "linkSent"}
        <p class="text-body-sm">{m.account_2fa_otpSentHint()}</p>
        <form
          class="flex flex-col gap-3"
          method="POST"
          action="?/enable"
          use:enhance={() => {
            reset();
            busy = true;
            return async ({ result }) => {
              busy = false;
              if (result.type === "failure") {
                needsReauth = result.data?.needsReauth === true;
                error = needsReauth ? "" : ((result.data?.error as string) ?? "");
                return;
              }
              if (result.type === "success" && result.data) {
                const totpURI = result.data.totpURI as string;
                backupCodes = (result.data.backupCodes as string[]) ?? [];
                manualKey = secretFromUri(totpURI);
                qrDataUrl = await QRCode.toDataURL(totpURI);
                phase = "setup";
              }
            };
          }}
        >
          <div class="flex gap-2">
            <button type="submit" class={btnClass} disabled={busy}>
              {m.account_2fa_enable()}
            </button>
            <button
              type="button"
              class={secondaryBtnClass}
              disabled={busy}
              onclick={() => {
                reset();
                phase = "idle";
              }}
            >
              {m.common_cancel()}
            </button>
          </div>
        </form>
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
        <label class="flex items-center gap-2 text-body-sm">
          <input type="checkbox" bind:checked={savedBackupCodes} />
          <span>{m.account_2fa_savedBackupConfirm()}</span>
        </label>
        <form
          class="flex flex-col gap-3"
          method="POST"
          action="?/verify"
          use:enhance={() => {
            reset();
            busy = true;
            return async ({ result, update }) => {
              busy = false;
              if (result.type === "failure") {
                error = (result.data?.error as string) ?? m.account_2fa_errorGeneric();
                return;
              }
              if (result.type === "redirect") {
                toasts.success(m.account_2fa_enabledDone());
                await update();
                return;
              }
              if (result.type === "success") {
                toasts.success(m.account_2fa_enabledDone());
                code = "";
                phase = "idle";
                await invalidateAll();
              }
            };
          }}
        >
          <input type="hidden" name="returnTo" value={data.returnTo ?? ""} />
          <label class="flex flex-col gap-1.5">
            <span class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.account_2fa_codeLabel()}
            </span>
            <input
              name="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              bind:value={code}
              class={inputClass}
            />
          </label>
          <button
            type="submit"
            class={btnClass}
            disabled={busy || code.length < 6 || !savedBackupCodes}
          >
            {m.account_2fa_verify()}
          </button>
        </form>
      {/if}
    </Card>
  </Section>
</PageContainer>
