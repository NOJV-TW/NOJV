<script lang="ts">
  import QRCode from "qrcode";
  import { untrack } from "svelte";
  import { enhance } from "$app/forms";
  import { page } from "$app/state";
  import { authClient } from "$lib/auth.client";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { Button } from "$lib/components/primitives/ui/button";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Input } from "$lib/components/primitives/ui/input";
  import FormField from "$lib/components/primitives/ui/FormField.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import type { ActionData, PageData } from "./$types";

  type Phase = PageData["phase"] | "totp-setup";

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const initialData = untrack(() => data);
  const initialAction = untrack(() => form) as Record<string, unknown> | null;
  const initialRecoveryMode = untrack(() => page.url.searchParams.get("recovery") === "1");
  const initialTotpUri = (initialAction?.totpURI as string | undefined) ?? "";
  let phase = $state<Phase>(
    initialTotpUri
      ? "totp-setup"
      : ((initialAction?.phase as Phase | undefined) ?? initialData.phase),
  );
  let hasTotp = $state((initialAction?.hasTotp as boolean | undefined) ?? initialData.hasTotp);
  let hasPasskey = $state(
    (initialAction?.hasPasskey as boolean | undefined) ?? initialData.hasPasskey,
  );
  let identity = $state("");
  let password = $state("");
  let currentPassword = $state("");
  let newPassword = $state("");
  let confirmPassword = $state("");
  let code = $state("");
  let error = $state((initialAction?.error as string | undefined) ?? "");
  let loading = $state(false);
  let devOtp = $state((initialAction?.devOtp as string | undefined) ?? "");
  let emailSent = $state(
    !initialRecoveryMode && initialData.phase === "email-setup" && initialAction?.sent === true,
  );
  let qrDataUrl = $state("");
  let manualKey = $state(
    initialTotpUri ? (new URL(initialTotpUri).searchParams.get("secret") ?? "") : "",
  );
  let backupCodes = $state<string[]>(
    (initialAction?.backupCodes as string[] | undefined) ?? [],
  );
  let savedBackupCodes = $state(false);
  let destination = $state(
    (initialAction?.destination as string | undefined) ?? initialData.returnTo,
  );
  let regularAdmin = $state((initialAction?.regularAdmin as boolean | undefined) ?? false);
  let recoveryMode = $state(initialRecoveryMode);
  let recoveryEmailSent = $state(initialRecoveryMode && initialAction?.sent === true);
  let backupCode = $state("");

  $effect(() => {
    if (!initialTotpUri || qrDataUrl) return;
    void QRCode.toDataURL(initialTotpUri).then((value) => {
      qrDataUrl = value;
    });
  });

  const phaseMeta = $derived.by(() => {
    switch (phase) {
      case "change-password":
        return {
          current: 2,
          title: m.auth_adminFlow_changePasswordTitle(),
          hint: m.auth_adminFlow_changePasswordHint(),
        };
      case "email-setup":
        return {
          current: 3,
          title: m.auth_adminFlow_emailTitle(),
          hint: m.auth_adminFlow_emailHint(),
        };
      case "choose-factor":
        return {
          current: 4,
          title: m.auth_adminFlow_chooseTitle(),
          hint: m.auth_adminFlow_chooseHint(),
        };
      case "totp-setup":
        return {
          current: 4,
          title: m.auth_adminFlow_totpTitle(),
          hint: m.account_totp_setupHint(),
        };
      case "verify-factor":
        return {
          current: 2,
          title: recoveryMode
            ? m.auth_adminFlow_recoveryTitle()
            : m.auth_adminFlow_verifyTitle(),
          hint: recoveryMode ? m.auth_adminFlow_recoveryHint() : m.auth_adminFlow_verifyHint(),
        };
      default:
        return {
          current: 1,
          title: m.auth_adminSignIn(),
          hint: m.auth_adminFlow_passwordHint(),
        };
    }
  });

  $effect(() => {
    if (page.url.searchParams.get("error") === "account-disabled") {
      error = m.auth_accountDisabled();
    } else if (page.url.searchParams.get("error") === "session-expired") {
      error = m.auth_adminFlow_sessionExpired();
    }
  });

  function actionError(result: { data?: Record<string, unknown> | undefined }): string {
    return (result.data?.error as string) ?? m.auth_invalidCredentials();
  }

  async function finish(destinationOverride?: string) {
    window.location.assign(destinationOverride ?? destination);
  }

  async function verifyTotp() {
    error = "";
    loading = true;
    const result = await authClient.twoFactor.verifyTotp({ code });
    loading = false;
    if (result.error) {
      error = result.error.message ?? m.auth_invalidCredentials();
      return;
    }
    await finish();
  }

  async function verifyPasskey() {
    error = "";
    loading = true;
    try {
      const result = await authClient.signIn.passkey();
      if (result?.error) {
        error = result.error.message ?? m.account_passkey_verifyFailed();
        return;
      }
      await finish();
    } catch {
      error = m.account_passkey_verifyFailed();
    } finally {
      loading = false;
    }
  }

  async function setupPasskey() {
    error = "";
    loading = true;
    try {
      const result = await authClient.passkey.addPasskey({ name: "Super admin passkey" });
      if (result?.error) {
        error = result.error.message ?? m.account_passkey_addError();
        return;
      }
      await finish();
    } catch {
      error = m.account_passkey_addError();
    } finally {
      loading = false;
    }
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

  async function showTotpSetup(resultData: Record<string, unknown>) {
    const uri = resultData.totpURI as string;
    backupCodes = (resultData.backupCodes as string[]) ?? [];
    manualKey = new URL(uri).searchParams.get("secret") ?? "";
    qrDataUrl = await QRCode.toDataURL(uri);
    code = "";
    phase = "totp-setup";
  }

  const secondaryButton =
    "inline-flex w-full items-center justify-center rounded-md border border-border px-4 py-2.5 text-body-sm font-medium transition-colors duration-fast ease-out-soft hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";
</script>

<div class="flex min-h-[60vh] items-center justify-center py-6">
  <Card variant="elevated" size="hero" class="w-full max-w-md">
    <div class="flex flex-col gap-2 text-center">
      <div class="flex items-center justify-center gap-3">
        <h1 class="text-title-lg font-semibold">{phaseMeta.title}</h1>
        <Badge variant="outline" size="sm">{m.auth_adminBadge()}</Badge>
      </div>
      <p class="text-body-sm text-muted-foreground">{phaseMeta.hint}</p>
      {#if phase !== "password"}
        <p class="text-caption font-medium text-muted-foreground">
          {m.auth_adminFlow_progress({ current: phaseMeta.current, total: 4 })}
        </p>
      {/if}
    </div>

    {#if error}
      <div
        class="rounded-sm border border-destructive/30 bg-destructive/10 p-3 text-body-sm text-destructive"
        role="alert"
      >
        {error}
      </div>
    {/if}
    {#if devOtp}
      <p class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-body-sm">
        {m.account_emailVerification_devCode()}
        <code class="font-mono font-semibold">{devOtp}</code>
      </p>
    {/if}

    {#if phase === "password"}
      <form
        class="flex flex-col gap-4"
        method="POST"
        action="?/password"
        use:enhance={() => {
          error = "";
          loading = true;
          return async ({ result }) => {
            loading = false;
            if (result.type === "failure") {
              error = actionError(result);
              return;
            }
            if (result.type !== "success" || !result.data) return;
            const next = result.data.phase as string;
            if (next === "complete") {
              await finish((result.data.destination as string) ?? "/dashboard");
              return;
            }
            currentPassword = password;
            password = "";
            hasTotp = (result.data.hasTotp as boolean) ?? hasTotp;
            hasPasskey = (result.data.hasPasskey as boolean) ?? hasPasskey;
            if (result.data.regularAdmin) {
              destination = "/dashboard";
              recoveryMode = false;
              regularAdmin = true;
            }
            phase = next as Phase;
          };
        }}
      >
        <FormField label={m.auth_usernameOrEmail()} for="admin-signin-identity" required>
          <Input
            id="admin-signin-identity"
            autocomplete="username"
            name="identity"
            bind:value={identity}
            required
          />
        </FormField>
        <FormField label={m.auth_password()} for="admin-signin-password" required>
          <Input
            id="admin-signin-password"
            autocomplete="current-password"
            name="password"
            bind:value={password}
            required
            type="password"
          />
        </FormField>
        <Button
          type="submit"
          variant="default"
          size="lg"
          class="w-full"
          {loading}
          disabled={loading}
        >
          {loading ? m.auth_signingIn() : m.auth_signIn()}
        </Button>
      </form>
    {:else if phase === "change-password"}
      <form
        class="flex flex-col gap-4"
        method="POST"
        action="?/changePassword"
        use:enhance={() => {
          error = "";
          loading = true;
          return async ({ result }) => {
            loading = false;
            if (result.type === "failure") {
              error = actionError(result);
              return;
            }
            if (result.type === "success") {
              currentPassword = "";
              newPassword = "";
              confirmPassword = "";
              phase = result.data?.phase as Phase;
            }
          };
        }}
      >
        <FormField
          label={m.account_changePassword_current()}
          for="admin-current-password"
          required
        >
          <Input
            id="admin-current-password"
            name="currentPassword"
            autocomplete="current-password"
            type="password"
            bind:value={currentPassword}
            required
          />
        </FormField>
        <FormField label={m.account_changePassword_new()} for="admin-new-password" required>
          <Input
            id="admin-new-password"
            name="newPassword"
            autocomplete="new-password"
            type="password"
            bind:value={newPassword}
            minlength={8}
            required
          />
        </FormField>
        <FormField
          label={m.account_changePassword_confirm()}
          for="admin-confirm-password"
          required
        >
          <Input
            id="admin-confirm-password"
            name="confirmPassword"
            autocomplete="new-password"
            type="password"
            bind:value={confirmPassword}
            minlength={8}
            required
          />
        </FormField>
        <Button
          type="submit"
          variant="default"
          size="lg"
          class="w-full"
          {loading}
          disabled={loading}
        >
          {m.account_changePassword_submit()}
        </Button>
      </form>
    {:else if phase === "email-setup"}
      {#if !emailSent}
        <form
          method="POST"
          action="?/sendSecuritySetupOtp"
          use:enhance={() => {
            error = "";
            loading = true;
            return async ({ result }) => {
              loading = false;
              if (result.type === "failure") {
                error = actionError(result);
                return;
              }
              if (result.type === "success") {
                emailSent = true;
                devOtp = (result.data?.devOtp as string) ?? "";
              }
            };
          }}
        >
          <Button
            type="submit"
            variant="default"
            size="lg"
            class="w-full"
            {loading}
            disabled={loading}
          >
            {m.account_emailVerification_sendCode()}
          </Button>
        </form>
      {:else}
        <form
          class="flex flex-col gap-4"
          method="POST"
          action="?/unlockSecuritySettings"
          use:enhance={() => {
            error = "";
            loading = true;
            return async ({ result }) => {
              loading = false;
              if (result.type === "failure") {
                error = actionError(result);
                return;
              }
              phase = "choose-factor";
              code = "";
            };
          }}
        >
          <FormField
            label={m.account_emailVerification_codeLabel()}
            for="admin-email-code"
            required
          >
            <Input
              id="admin-email-code"
              name="otp"
              autocomplete="one-time-code"
              inputmode="numeric"
              bind:value={code}
              required
            />
          </FormField>
          <Button
            type="submit"
            variant="default"
            size="lg"
            class="w-full"
            {loading}
            disabled={loading || code.length < 6}
          >
            {m.account_securityUnlock_continue()}
          </Button>
        </form>
      {/if}
    {:else if phase === "choose-factor"}
      <div class="flex flex-col gap-3">
        <form
          method="POST"
          action="?/beginTotpSetup"
          use:enhance={() => {
            error = "";
            loading = true;
            return async ({ result }) => {
              loading = false;
              if (result.type === "failure") {
                error = actionError(result);
                return;
              }
              if (result.type === "success" && result.data) await showTotpSetup(result.data);
            };
          }}
        >
          <Button
            type="submit"
            variant="default"
            size="lg"
            class="w-full"
            {loading}
            disabled={loading}
          >
            {m.auth_adminFlow_chooseTotp()}
          </Button>
        </form>
        <button type="button" class={secondaryButton} disabled={loading} onclick={setupPasskey}>
          {m.auth_adminFlow_choosePasskey()}
        </button>
      </div>
    {:else if phase === "totp-setup"}
      <div class="flex flex-col gap-4">
        {#if qrDataUrl}
          <img
            src={qrDataUrl}
            alt="TOTP QR code"
            class="mx-auto h-44 w-44 rounded-md border border-border"
          />
        {/if}
        <div class="flex flex-col gap-1">
          <span class="text-caption uppercase tracking-wide text-muted-foreground"
            >{m.account_2fa_manualKey()}</span
          >
          <code class="break-all rounded bg-muted px-2 py-1 text-body-sm">{manualKey}</code>
        </div>
        <ul class="grid grid-cols-2 gap-1 font-mono text-body-sm">
          {#each backupCodes as backupCode (backupCode)}
            <li class="rounded bg-muted px-2 py-1">{backupCode}</li>
          {/each}
        </ul>
        <button type="button" class={secondaryButton} onclick={downloadBackupCodes}
          >{m.account_2fa_backupDownload()}</button
        >
        <label class="flex items-center gap-2 text-body-sm">
          <input type="checkbox" bind:checked={savedBackupCodes} />
          <span>{m.account_2fa_savedBackupConfirm()}</span>
        </label>
        <form
          class="flex flex-col gap-4"
          method="POST"
          action="?/confirmTotpSetup"
          use:enhance={() => {
            error = "";
            loading = true;
            return async ({ result }) => {
              loading = false;
              if (result.type === "failure") {
                error = actionError(result);
                return;
              }
              if (result.type === "redirect") {
                window.location.assign(result.location);
                return;
              }
              await finish();
            };
          }}
        >
          <input type="hidden" name="returnTo" value={destination} />
          <FormField label={m.account_totp_confirmNew()} for="admin-new-totp" required>
            <Input
              id="admin-new-totp"
              name="code"
              autocomplete="one-time-code"
              inputmode="numeric"
              bind:value={code}
              required
            />
          </FormField>
          <Button
            type="submit"
            variant="default"
            size="lg"
            class="w-full"
            {loading}
            disabled={loading || code.length < 6 || !savedBackupCodes}
          >
            {m.account_totp_confirmSetup()}
          </Button>
        </form>
      </div>
    {:else if recoveryMode}
      <div class="flex flex-col gap-5">
        <div class="rounded-md border border-warning/40 bg-warning/10 p-3 text-body-sm">
          {m.auth_adminFlow_recoveryWarning()}
        </div>

        <form
          class="flex flex-col gap-3"
          method="POST"
          action="?/recoverWithBackupCode"
          use:enhance={() => {
            error = "";
            loading = true;
            return async ({ result }) => {
              loading = false;
              if (result.type === "failure") {
                error = actionError(result);
                return;
              }
              if (result.type === "success") {
                recoveryMode = false;
                hasTotp = false;
                hasPasskey = false;
                phase = "choose-factor";
              }
            };
          }}
        >
          <FormField label={m.auth_adminFlow_backupCode()} for="admin-recovery-backup" required>
            <Input
              id="admin-recovery-backup"
              name="backupCode"
              autocomplete="one-time-code"
              bind:value={backupCode}
              required
            />
          </FormField>
          <Button type="submit" variant="default" class="w-full" {loading} disabled={loading}>
            {m.auth_adminFlow_recoverWithBackup()}
          </Button>
        </form>

        <div class="flex items-center gap-3" aria-hidden="true">
          <span class="h-px flex-1 bg-border"></span>
          <span class="text-caption text-muted-foreground">{m.auth_adminFlow_or()}</span>
          <span class="h-px flex-1 bg-border"></span>
        </div>

        {#if !recoveryEmailSent}
          <form
            method="POST"
            action="?/sendRecoveryEmailOtp"
            use:enhance={() => {
              error = "";
              loading = true;
              return async ({ result }) => {
                loading = false;
                if (result.type === "failure") {
                  error = actionError(result);
                  return;
                }
                if (result.type === "success") {
                  recoveryEmailSent = true;
                  devOtp = (result.data?.devOtp as string) ?? "";
                }
              };
            }}
          >
            <button type="submit" class={secondaryButton} disabled={loading}>
              {m.auth_adminFlow_sendRecoveryEmail()}
            </button>
          </form>
        {:else}
          <form
            class="flex flex-col gap-3"
            method="POST"
            action="?/recoverWithEmailOtp"
            use:enhance={() => {
              error = "";
              loading = true;
              return async ({ result }) => {
                loading = false;
                if (result.type === "failure") {
                  error = actionError(result);
                  return;
                }
                if (result.type === "success") {
                  recoveryMode = false;
                  hasTotp = false;
                  hasPasskey = false;
                  code = "";
                  currentPassword = "";
                  phase = "choose-factor";
                }
              };
            }}
          >
            <FormField
              label={m.account_emailVerification_codeLabel()}
              for="admin-recovery-email"
              required
            >
              <Input
                id="admin-recovery-email"
                name="otp"
                autocomplete="one-time-code"
                inputmode="numeric"
                bind:value={code}
                required
              />
            </FormField>
            <FormField
              label={m.auth_adminFlow_reenterPassword()}
              for="admin-recovery-password"
              required
            >
              <Input
                id="admin-recovery-password"
                name="password"
                autocomplete="current-password"
                type="password"
                bind:value={currentPassword}
                required
              />
            </FormField>
            <Button
              type="submit"
              variant="default"
              class="w-full"
              {loading}
              disabled={loading || code.length < 6}
            >
              {m.auth_adminFlow_resetFactors()}
            </Button>
          </form>
        {/if}

        <button
          type="button"
          class="text-center text-caption text-muted-foreground underline-offset-4 hover:underline"
          onclick={() => {
            recoveryMode = false;
            error = "";
          }}
        >
          {m.auth_adminFlow_backToVerification()}
        </button>
      </div>
    {:else}
      <div class="flex flex-col gap-3">
        {#if hasTotp}
          <form
            class="flex flex-col gap-4"
            onsubmit={(event) => {
              event.preventDefault();
              void verifyTotp();
            }}
          >
            <FormField
              label={m.account_securityUnlock_currentTotp()}
              for="admin-signin-totp"
              required
            >
              <Input
                id="admin-signin-totp"
                autocomplete="one-time-code"
                inputmode="numeric"
                bind:value={code}
                required
              />
            </FormField>
            <Button
              type="submit"
              variant="default"
              size="lg"
              class="w-full"
              {loading}
              disabled={loading || code.length < 6}
            >
              {m.account_securityUnlock_continue()}
            </Button>
          </form>
        {/if}
        {#if hasPasskey}
          <button
            type="button"
            class={hasTotp
              ? secondaryButton
              : `${secondaryButton} bg-primary text-primary-foreground`}
            disabled={loading}
            onclick={verifyPasskey}
          >
            {m.account_passkey_verifyButton()}
          </button>
        {/if}
        {#if !regularAdmin}
          <button
            type="button"
            class="text-center text-caption text-muted-foreground underline-offset-4 hover:underline"
            onclick={() => {
              recoveryMode = true;
              error = "";
            }}
          >
            {m.auth_adminFlow_recovery()}
          </button>
        {/if}
      </div>
    {/if}

    {#if phase === "password"}
      <div class="text-center">
        <a
          class="text-body-sm text-muted-foreground underline-offset-4 hover:underline"
          href="/signin"
        >
          {m.auth_backToRegularSignIn()}
        </a>
      </div>
    {/if}
  </Card>
</div>
