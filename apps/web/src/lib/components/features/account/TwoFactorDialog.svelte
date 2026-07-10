<script lang="ts">
  import QRCode from "qrcode";
  import { enhance } from "$app/forms";
  import { goto, invalidateAll } from "$app/navigation";
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";

  interface Props {
    open: boolean;
    twoFactorEnabled: boolean;
    hasPassword: boolean;
    returnTo: string | null;
  }

  let { open = $bindable(false), twoFactorEnabled, hasPassword, returnTo }: Props = $props();

  let phase = $state<"idle" | "setup">("idle");
  let code = $state("");
  let password = $state("");
  let manageCode = $state("");
  let managePassword = $state("");
  let enrollOtp = $state("");
  let needsOtp = $state(false);
  let error = $state("");
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
  }

  function downloadBackupCodes() {
    const blob = new Blob([backupCodes.join("\n") + "\n"], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nojv-backup-codes.txt";
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function onEnrolled(data: Record<string, unknown>) {
    const totpURI = data.totpURI as string;
    backupCodes = (data.backupCodes as string[]) ?? [];
    manualKey = secretFromUri(totpURI);
    qrDataUrl = await QRCode.toDataURL(totpURI);
    password = "";
    enrollOtp = "";
    phase = "setup";
  }

  const manageReady = $derived(
    hasPassword ? managePassword.length > 0 : manageCode.length >= 6,
  );

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
  const btnClass =
    "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-body-sm font-medium text-primary-foreground transition-colors duration-fast ease-out-soft hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
  const secondaryBtnClass =
    "inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-body-sm font-medium transition-colors duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";
</script>

<Dialog.Root bind:open>
  <Dialog.Content showCloseButton class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{m.account_verification_totp()}</Dialog.Title>
      <Dialog.Description>{m.account_2fa_description()}</Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-4">
      {#if error}
        <p class="text-caption text-destructive" role="alert">{error}</p>
      {/if}

      {#if twoFactorEnabled}
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
            <button
              type="button"
              class={`${secondaryBtnClass} mt-2 self-start`}
              onclick={downloadBackupCodes}
            >
              {m.account_2fa_backupDownload()}
            </button>
          </div>
        {/if}
        <label class="flex flex-col gap-1.5">
          <span class="text-caption uppercase tracking-wide text-muted-foreground">
            {hasPassword ? m.account_2fa_passwordLabel() : m.account_2fa_manageCodeLabel()}
          </span>
          {#if hasPassword}
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
                  open = false;
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
      {:else if hasPassword && phase === "idle"}
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
                error = (result.data?.error as string) ?? "";
                return;
              }
              if (result.type === "success" && result.data) {
                await onEnrolled(result.data);
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
        <p class="text-body-sm">{m.account_2fa_setupEnableHint()}</p>
        {#if needsOtp}
          <p class="text-caption text-muted-foreground">{m.account_2fa_needStepUp()}</p>
          <form
            method="POST"
            action="?/sendEmailOtp"
            use:enhance={() => {
              reset();
              busy = true;
              return async ({ result }) => {
                busy = false;
                if (result.type === "success") {
                  toasts.success(m.account_2fa_activate_codeSent());
                } else if (result.type === "failure") {
                  error = (result.data?.error as string) ?? m.account_2fa_errorGeneric();
                }
              };
            }}
          >
            <button type="submit" class={secondaryBtnClass} disabled={busy}>
              {m.account_2fa_activate_sendCode()}
            </button>
          </form>
        {/if}
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
                if (result.data?.needsStepUp) {
                  needsOtp = true;
                  error = m.account_2fa_needStepUp();
                  return;
                }
                error = (result.data?.error as string) ?? m.account_2fa_errorGeneric();
                return;
              }
              if (result.type === "success" && result.data) {
                await onEnrolled(result.data);
              }
            };
          }}
        >
          {#if needsOtp}
            <label class="flex flex-col gap-1.5">
              <span class="text-caption uppercase tracking-wide text-muted-foreground">
                {m.account_2fa_activate_codeLabel()}
              </span>
              <input
                name="otp"
                inputmode="numeric"
                autocomplete="one-time-code"
                bind:value={enrollOtp}
                class={inputClass}
              />
            </label>
          {/if}
          <button
            type="submit"
            class={btnClass}
            disabled={busy || (needsOtp && enrollOtp.length < 6)}
          >
            {m.account_2fa_enable()}
          </button>
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
            <button
              type="button"
              class={`${secondaryBtnClass} mt-2 self-start`}
              onclick={downloadBackupCodes}
            >
              {m.account_2fa_backupDownload()}
            </button>
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
            return async ({ result }) => {
              busy = false;
              if (result.type === "failure") {
                error = (result.data?.error as string) ?? m.account_2fa_errorGeneric();
                return;
              }
              if (result.type === "redirect") {
                await goto(result.location, { invalidateAll: true });
                return;
              }
              if (result.type === "success") {
                toasts.success(m.account_2fa_enabledDone());
                code = "";
                phase = "idle";
                needsOtp = false;
                open = false;
                await invalidateAll();
              }
            };
          }}
        >
          <input type="hidden" name="returnTo" value={returnTo ?? ""} />
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
    </div>
  </Dialog.Content>
</Dialog.Root>
