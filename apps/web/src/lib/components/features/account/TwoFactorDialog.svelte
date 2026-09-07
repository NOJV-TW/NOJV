<script lang="ts">
  import QRCode from "qrcode";
  import { enhance } from "$app/forms";
  import { goto, invalidateAll } from "$app/navigation";
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";

  interface Props {
    canRemove: boolean;
    hasTotp: boolean;
    open: boolean;
    returnTo: string | null;
  }

  let { open = $bindable(false), canRemove, hasTotp, returnTo }: Props = $props();

  let phase = $state<"manage" | "setup">("manage");
  let code = $state("");
  let error = $state("");
  let busy = $state(false);
  let qrDataUrl = $state("");
  let manualKey = $state("");
  let backupCodes = $state<string[]>([]);
  let savedBackupCodes = $state(false);

  function reset() {
    phase = "manage";
    code = "";
    error = "";
    busy = false;
    qrDataUrl = "";
    manualKey = "";
    backupCodes = [];
    savedBackupCodes = false;
  }

  function downloadBackupCodes() {
    const blob = new Blob([backupCodes.join("\n") + "\n"], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "nojv-backup-codes.txt";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function showEnrollment(data: Record<string, unknown>) {
    const totpURI = data.totpURI as string;
    backupCodes = (data.backupCodes as string[]) ?? [];
    manualKey = new URL(totpURI).searchParams.get("secret") ?? "";
    qrDataUrl = await QRCode.toDataURL(totpURI);
    phase = "setup";
  }

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
  const primaryButton =
    "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-body-sm font-medium text-primary-foreground transition-colors duration-fast ease-out-soft hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
  const secondaryButton =
    "inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-body-sm font-medium transition-colors duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";
</script>

<Dialog.Root bind:open onOpenChange={(next) => next || reset()}>
  <Dialog.Content showCloseButton class="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>{m.account_verification_totp()}</Dialog.Title>
      <Dialog.Description>
        {hasTotp ? m.account_totp_manageHint() : m.account_totp_setupHint()}
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-4">
      {#if error}
        <p class="text-body-sm text-destructive" role="alert">{error}</p>
      {/if}

      {#if phase === "manage"}
        <form
          method="POST"
          action="?/beginTotpSetup"
          use:enhance={() => {
            error = "";
            busy = true;
            return async ({ result }) => {
              busy = false;
              if (result.type === "failure") {
                error = (result.data?.error as string) ?? m.account_2fa_errorGeneric();
                return;
              }
              if (result.type === "success" && result.data) await showEnrollment(result.data);
            };
          }}
        >
          <button type="submit" class={primaryButton} disabled={busy}>
            {hasTotp ? m.account_totp_replace() : m.account_verification_setup()}
          </button>
        </form>

        {#if hasTotp}
          <form
            method="POST"
            action="?/regenerateBackupCodes"
            use:enhance={() => {
              error = "";
              busy = true;
              return async ({ result }) => {
                busy = false;
                if (result.type === "failure") {
                  error = (result.data?.error as string) ?? m.account_2fa_errorGeneric();
                  return;
                }
                if (result.type === "success") {
                  backupCodes = (result.data?.backupCodes as string[]) ?? [];
                }
              };
            }}
          >
            <button type="submit" class={secondaryButton} disabled={busy}>
              {m.account_2fa_regenerate()}
            </button>
          </form>
          {#if canRemove}
            <form
              method="POST"
              action="?/removeTotp"
              use:enhance={() => {
                error = "";
                busy = true;
                return async ({ result }) => {
                  busy = false;
                  if (result.type === "failure") {
                    error = (result.data?.error as string) ?? m.account_2fa_errorGeneric();
                    return;
                  }
                  toasts.success(m.account_totp_removed());
                  open = false;
                  await invalidateAll();
                };
              }}
            >
              <button
                type="submit"
                class="rounded-md border border-destructive/40 px-4 py-2 text-body-sm font-medium text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy}
              >
                {m.account_totp_remove()}
              </button>
            </form>
          {/if}
          {#if !canRemove}
            <p class="text-caption text-muted-foreground">
              {m.account_security_superAdminLastFactor()}
            </p>
          {/if}
        {/if}
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
          <div class="flex flex-col gap-2">
            <span class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.account_2fa_backupTitle()}
            </span>
            <p class="text-caption text-muted-foreground">
              {m.account_2fa_backupInstruction()}
            </p>
            <ul class="grid grid-cols-2 gap-1 font-mono text-body-sm">
              {#each backupCodes as backupCode (backupCode)}
                <li class="rounded bg-muted px-2 py-1">{backupCode}</li>
              {/each}
            </ul>
            <button
              type="button"
              class={`${secondaryButton} self-start`}
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
          action="?/confirmTotpSetup"
          use:enhance={() => {
            error = "";
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
              toasts.success(m.account_totp_configured());
              open = false;
              await invalidateAll();
            };
          }}
        >
          <input type="hidden" name="returnTo" value={returnTo ?? ""} />
          <label class="flex flex-col gap-1.5">
            <span class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.account_totp_confirmNew()}
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
            class={primaryButton}
            disabled={busy || code.length < 6 || !savedBackupCodes}
          >
            {m.account_totp_confirmSetup()}
          </button>
        </form>
      {/if}

      {#if phase === "manage" && backupCodes.length > 0}
        <div class="flex flex-col gap-2 border-t border-border-subtle pt-4">
          <p class="text-caption text-muted-foreground">
            {m.account_2fa_backupInstruction()}
          </p>
          <ul class="grid grid-cols-2 gap-1 font-mono text-body-sm">
            {#each backupCodes as backupCode (backupCode)}
              <li class="rounded bg-muted px-2 py-1">{backupCode}</li>
            {/each}
          </ul>
          <button
            type="button"
            class={`${secondaryButton} self-start`}
            onclick={downloadBackupCodes}
          >
            {m.account_2fa_backupDownload()}
          </button>
        </div>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
