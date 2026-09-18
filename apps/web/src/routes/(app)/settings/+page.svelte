<script lang="ts">
  import { untrack } from "svelte";
  import { enhance } from "$app/forms";
  import { page } from "$app/state";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { m } from "$lib/paraglide/messages.js";
  import {
    Bell,
    ChevronRight,
    Compass,
    Fingerprint,
    KeyRound,
    Mail,
    ShieldCheck,
    Trash2,
  } from "@lucide/svelte";
  import { replayStudentTour } from "$lib/onboarding/student-tour";
  import { replayTeacherTour } from "$lib/onboarding/teacher-tour";
  import NotificationPreferencesDialog from "$lib/components/features/account/NotificationPreferencesDialog.svelte";
  import TwoFactorDialog from "$lib/components/features/account/TwoFactorDialog.svelte";
  import SecuritySettingsUnlockDialog from "$lib/components/features/account/SecuritySettingsUnlockDialog.svelte";
  import PasskeyDialog from "$lib/components/features/account/PasskeyDialog.svelte";
  import SchoolVerificationSection from "$lib/components/features/auth/SchoolVerification.svelte";
  import ProviderIcon from "$lib/components/features/auth/ProviderIcon.svelte";
  import Section from "$lib/components/primitives/ui/Section.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { Input } from "$lib/components/primitives/ui/input";
  import { toasts } from "$lib/stores/toast";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  let notificationsOpen = $state(false);
  let totpOpen = $state(false);
  let passkeyOpen = $state(false);
  let unlockOpen = $state(untrack(() => data.setupAutoOpen));
  let pendingSecurityMethod = $state<"totp" | "passkey" | "email" | null>(null);

  let securityEmailOpen = $state(false);
  let securityEmailValue = $state("");
  let securityEmailBusy = $state(false);
  let securityEmailError = $state("");
  let securityEmailSentTo = $state("");

  const securityEmailSubmit: SubmitFunction = () => {
    securityEmailError = "";
    securityEmailBusy = true;
    return async ({ result, update }) => {
      securityEmailBusy = false;
      if (result.type === "failure") {
        securityEmailError = mapSecurityEmailError((result.data?.error as string) ?? "");
        return;
      }
      if (result.type === "success") {
        securityEmailSentTo = (result.data?.securityEmailSentTo as string) ?? data.email;
        securityEmailOpen = false;
        securityEmailValue = "";
      }
      await update({ reset: false });
    };
  };

  function mapSecurityEmailError(code: string): string {
    switch (code) {
      case "securityEmailInvalid":
        return m.account_securityEmail_error_invalid();
      case "securityEmailUnchanged":
        return m.account_securityEmail_error_unchanged();
      case "securityEmailTaken":
        return m.account_securityEmail_error_taken();
      case "securityEmailLocked":
        return m.account_securityEmail_error_locked();
      case "securityEmailForbidden":
        return m.account_securityEmail_error_forbidden();
      default:
        return m.account_securityEmail_error_failed();
    }
  }

  function openSecurityEmailForm() {
    securityEmailError = "";
    securityEmailSentTo = "";
    if (data.hasSecurityFactor && !data.securitySettingsUnlocked) {
      pendingSecurityMethod = "email";
      unlockOpen = true;
      return;
    }
    securityEmailOpen = true;
  }

  const passkeyEnabled = $derived(data.passkeys.length > 0);
  const factorKindCount = $derived((data.hasTotp ? 1 : 0) + (passkeyEnabled ? 1 : 0));

  function openSecurityMethod(method: "totp" | "passkey") {
    if (data.securitySettingsUnlocked) {
      if (method === "totp") totpOpen = true;
      else passkeyOpen = true;
      return;
    }
    pendingSecurityMethod = method;
    unlockOpen = true;
  }

  function continueAfterUnlock() {
    if (pendingSecurityMethod === "totp") totpOpen = true;
    else if (pendingSecurityMethod === "passkey") passkeyOpen = true;
    else if (pendingSecurityMethod === "email") securityEmailOpen = true;
    pendingSecurityMethod = null;
  }

  let oauthBusy = $state(false);
  let oauthError = $state("");
  const providerLabel: Record<string, string> = { github: "GitHub", google: "Google" };
  const redirectError = $derived.by(() => {
    const code = page.url.searchParams.get("error");
    return code ? mapOAuthError(code) : "";
  });
  const connectionError = $derived(oauthError || redirectError);

  const linkedCount = $derived(data.accounts.length);
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

  function oauthSubmit(provider: string): SubmitFunction {
    return () => {
      oauthError = "";
      oauthBusy = true;
      return async ({ result, update }) => {
        oauthBusy = false;
        if (result.type === "failure") {
          oauthError = mapOAuthError((result.data?.error as string) ?? "");
          return;
        }
        if (result.type === "success" && result.data?.unlinked) {
          toasts.success(
            m.account_connections_unlinked({ provider: providerLabel[provider] ?? provider }),
          );
        }
        await update();
      };
    };
  }

  function mapOAuthError(code: string): string {
    switch (code) {
      case "orphan":
        return m.account_connections_error_orphan();
      case "unknownProvider":
        return m.account_connections_error_unknownProvider();
      case "linkFailed":
        return m.account_connections_error_linkFailed();
      case "unlinkFailed":
        return m.account_connections_error_unlinkFailed();
      case "account_already_linked_to_different_user":
        return m.account_connections_error_claimedByOther();
      case "unable_to_link_account":
      case "email_doesn't_match":
        return m.account_connections_error_linkFailed();
      default:
        return m.account_connections_error_unexpected();
    }
  }

  let deleteConfirmation = $state("");
  let deleteBusy = $state(false);
  let deleteError = $state("");
  const deleteArmed = $derived(
    deleteConfirmation.trim().toLowerCase() === data.email.toLowerCase(),
  );

  const deleteSubmit: SubmitFunction = () => {
    deleteError = "";
    deleteBusy = true;
    return async ({ result, update }) => {
      deleteBusy = false;
      if (result.type === "failure") {
        deleteError = mapDeleteError((result.data?.error as string) ?? "");
        return;
      }
      await update();
    };
  };

  function mapDeleteError(code: string): string {
    switch (code) {
      case "deleteConfirmation":
        return m.account_delete_error_confirmation();
      case "deleteBlocked":
        return m.account_delete_error_blocked();
      case "deleteForbidden":
        return m.account_delete_error_forbidden();
      default:
        return m.account_delete_error_unexpected();
    }
  }

  const settingLinkClass =
    "group flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-body-sm font-medium transition-colors duration-fast ease-out-soft hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
  const settingChevronClass =
    "h-4 w-4 text-muted-foreground transition-transform duration-fast ease-out-soft group-hover:translate-x-0.5";
  const methodRowClass =
    "flex items-center justify-between gap-3 px-4 py-3 text-body-sm font-medium";
  const methodBtnClass =
    "shrink-0 rounded-md border border-border px-3 py-1.5 text-caption font-medium transition-colors duration-fast ease-out-soft hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
</script>

<PageContainer width="form">
  <Section>
    {#snippet header()}
      <h1 class="text-title-lg font-semibold">{m.navigation_settings()}</h1>
    {/snippet}

    <Card variant="surface" size="md">
      <section>
        <SchoolVerificationSection isSchoolVerified={data.isSchoolVerified} />
      </section>

      <section class="flex flex-col gap-4 border-t border-border-subtle pt-4">
        <div class="flex flex-col gap-1">
          <h2 class="text-title-sm">{m.account_loginSecurity_title()}</h2>
          <p class="text-body-sm text-muted-foreground">{m.account_loginSecurity_hint()}</p>
        </div>
        <div class="overflow-hidden rounded-md border border-border">
          <div class="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div class="flex min-w-0 flex-col gap-1">
              <span
                class="flex items-center gap-2 text-caption uppercase tracking-wide text-muted-foreground"
              >
                <Mail aria-hidden="true" class="h-3.5 w-3.5" />
                {m.account_securityEmail_label()}
              </span>
              <span class="text-body font-medium break-all">{data.email}</span>
            </div>
            {#if data.canLinkProviders}
              <button
                type="button"
                class={methodBtnClass}
                aria-expanded={securityEmailOpen}
                onclick={() => {
                  if (securityEmailOpen) securityEmailOpen = false;
                  else openSecurityEmailForm();
                }}
              >
                {securityEmailOpen ? m.common_cancel() : m.account_securityEmail_change()}
              </button>
            {/if}
          </div>

          {#if securityEmailSentTo}
            <p
              class="flex items-start gap-2 border-t border-border-subtle bg-success/10 px-4 py-3 text-body-sm text-success"
              role="status"
            >
              <ShieldCheck aria-hidden="true" class="mt-0.5 h-4 w-4 shrink-0" />
              <span>{m.account_securityEmail_sent({ email: securityEmailSentTo })}</span>
            </p>
          {/if}

          {#if securityEmailOpen}
            <form
              method="POST"
              action="?/changeSecurityEmail"
              use:enhance={securityEmailSubmit}
              class="flex flex-col gap-3 border-t border-border-subtle bg-muted/30 px-4 py-3"
            >
              <p class="text-caption text-muted-foreground">
                {m.account_securityEmail_flowHint({ email: data.email })}
              </p>
              <label class="flex flex-col gap-1.5">
                <span class="text-caption font-medium">
                  {m.account_securityEmail_newLabel()}
                </span>
                <Input
                  name="newEmail"
                  type="email"
                  required
                  autocomplete="email"
                  spellcheck={false}
                  bind:value={securityEmailValue}
                  aria-invalid={securityEmailError ? "true" : undefined}
                  placeholder="you@example.com"
                />
              </label>
              {#if securityEmailError}
                <p class="text-body-sm text-destructive" role="alert">{securityEmailError}</p>
              {/if}
              <button
                type="submit"
                disabled={securityEmailBusy || securityEmailValue.trim().length === 0}
                class="{methodBtnClass} self-start disabled:cursor-not-allowed disabled:opacity-50"
              >
                {m.account_securityEmail_submit()}
              </button>
            </form>
          {/if}
        </div>
        <div class="flex flex-col gap-2">
          {#if data.hasPassword}
            <a href="/account/change-password" class={settingLinkClass}>
              <span class="flex items-center gap-2.5">
                <KeyRound aria-hidden="true" class="h-4 w-4 text-muted-foreground" />
                {m.account_changePassword_title()}
              </span>
              <ChevronRight aria-hidden="true" class={settingChevronClass} />
            </a>
          {/if}

          <section
            aria-labelledby="security-factors-heading"
            class="overflow-hidden rounded-md border border-border"
          >
            <div
              class="flex flex-wrap items-center justify-between gap-3 bg-muted/40 px-4 py-3"
            >
              <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h3 id="security-factors-heading" class="text-body-sm font-semibold">
                  {m.account_loginSecurity_factors()}
                </h3>
                <Badge variant={data.hasSecurityFactor ? "success" : "muted"} size="sm" dot>
                  {data.hasSecurityFactor
                    ? m.account_loginSecurity_configured({ count: factorKindCount })
                    : m.account_loginSecurity_notConfigured()}
                </Badge>
              </div>
              {#if data.securitySettingsUnlocked}
                <Badge variant="success" size="sm">{m.account_loginSecurity_unlocked()}</Badge>
              {:else}
                <button
                  type="button"
                  class={methodBtnClass}
                  onclick={() => (unlockOpen = true)}
                >
                  {m.account_loginSecurity_unlock()}
                </button>
              {/if}
            </div>

            <div class="divide-y divide-border-subtle border-t border-border-subtle">
              <div class={methodRowClass}>
                <span class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                  <ShieldCheck
                    aria-hidden="true"
                    class="h-4 w-4 shrink-0 text-muted-foreground"
                  />
                  <span>{m.account_verification_totp()}</span>
                  <Badge variant={data.hasTotp ? "success" : "muted"} size="sm" dot>
                    {data.hasTotp
                      ? m.account_verification_statusEnabled()
                      : m.account_verification_statusInactive()}
                  </Badge>
                </span>
                <button
                  type="button"
                  class={methodBtnClass}
                  onclick={() => openSecurityMethod("totp")}
                >
                  {data.hasTotp
                    ? m.account_verification_manage()
                    : m.account_verification_setup()}
                </button>
              </div>

              <div class={methodRowClass}>
                <span class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                  <Fingerprint
                    aria-hidden="true"
                    class="h-4 w-4 shrink-0 text-muted-foreground"
                  />
                  <span>Passkey</span>
                  <Badge variant={passkeyEnabled ? "success" : "muted"} size="sm" dot>
                    {passkeyEnabled
                      ? m.account_verification_statusEnabled()
                      : m.account_verification_statusInactive()}
                  </Badge>
                </span>
                <button
                  type="button"
                  class={methodBtnClass}
                  onclick={() => openSecurityMethod("passkey")}
                >
                  {passkeyEnabled
                    ? m.account_verification_manage()
                    : m.account_verification_setup()}
                </button>
              </div>
            </div>
            {#if data.isSuperAdmin}
              <p
                class="border-t border-border-subtle px-4 py-3 text-caption text-muted-foreground"
              >
                {m.account_security_superAdminRequirement()}
              </p>
            {/if}
          </section>
        </div>
      </section>

      {#if data.canLinkProviders}
        <section class="flex flex-col gap-4 border-t border-border-subtle pt-4">
          <div class="flex flex-col gap-1">
            <h2 class="text-title-sm">{m.account_connections_title()}</h2>
            <p class="text-body-sm text-muted-foreground">
              {m.account_connections_hint()}
            </p>
          </div>
          {#if connectionError}
            <p class="text-body-sm text-destructive" role="alert">{connectionError}</p>
          {/if}
          <div class="flex flex-col gap-3">
            {#each data.accounts as { provider, accountId, email, createdAt } (provider + accountId)}
              {@const lastMethod = linkedCount === 1 && !data.hasPassword}
              <div
                class="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3"
              >
                <div class="flex min-w-0 items-center gap-3">
                  <ProviderIcon {provider} class="size-5 shrink-0" />
                  <div class="flex min-w-0 flex-col">
                    <span class="truncate text-body-sm font-medium">
                      {email ?? providerLabel[provider]}
                    </span>
                    <span class="text-caption text-muted-foreground">
                      {#if email}{providerLabel[provider]} ·
                      {/if}{m.account_connections_linkedOn({
                        date: dateFormat.format(new Date(createdAt)),
                      })}
                    </span>
                  </div>
                </div>
                <form method="POST" action="?/unlink" use:enhance={oauthSubmit(provider)}>
                  <input type="hidden" name="provider" value={provider} />
                  <input type="hidden" name="accountId" value={accountId} />
                  <button
                    type="submit"
                    disabled={oauthBusy || lastMethod}
                    title={lastMethod ? m.account_connections_lastMethodHint() : undefined}
                    class="rounded-md border border-destructive/40 px-3 py-1.5 text-caption font-medium text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {m.account_connections_unlink()}
                  </button>
                </form>
              </div>
            {/each}
            <div class="flex flex-wrap gap-2">
              {#each ["google", "github"] as const as provider (provider)}
                <form method="POST" action="?/link" use:enhance={oauthSubmit(provider)}>
                  <input type="hidden" name="provider" value={provider} />
                  <button
                    type="submit"
                    disabled={oauthBusy}
                    class="inline-flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-1.5 text-caption font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ProviderIcon {provider} class="size-4" />
                    {m.account_connections_add({
                      provider: providerLabel[provider] ?? provider,
                    })}
                  </button>
                </form>
              {/each}
            </div>
            {#if data.accounts.some((account) => account.provider === "github")}
              <p class="text-caption text-muted-foreground">
                {m.account_connections_githubSwitchHint()}
              </p>
            {/if}
          </div>
        </section>
      {/if}

      <section class="flex flex-col gap-4 border-t border-border-subtle pt-4">
        <div class="flex flex-col gap-1">
          <h2 class="text-title-sm">{m.account_notifications_title()}</h2>
          <p class="text-body-sm text-muted-foreground">{m.account_notifications_hint()}</p>
        </div>
        <button
          type="button"
          class={settingLinkClass}
          onclick={() => (notificationsOpen = true)}
        >
          <span class="flex items-center gap-2.5">
            <Bell aria-hidden="true" class="h-4 w-4 text-muted-foreground" />
            {m.account_notifications_manage()}
          </span>
          <ChevronRight aria-hidden="true" class={settingChevronClass} />
        </button>
      </section>

      {#if data.platformRole === "student" || data.platformRole === "teacher"}
        <section class="flex flex-col gap-4 border-t border-border-subtle pt-4">
          <div class="flex flex-col gap-1">
            <h2 class="text-title-sm">{m.account_tourTitle()}</h2>
            <p class="text-body-sm text-muted-foreground">{m.account_tourHint()}</p>
          </div>
          <button
            type="button"
            class="{settingLinkClass} w-full text-left"
            onclick={() => {
              if (data.platformRole === "teacher") replayTeacherTour();
              else replayStudentTour();
            }}
          >
            <span class="flex items-center gap-2.5">
              <Compass aria-hidden="true" class="h-4 w-4 text-muted-foreground" />
              {m.account_tourReplay()}
            </span>
            <ChevronRight aria-hidden="true" class={settingChevronClass} />
          </button>
        </section>
      {/if}

      {#if data.platformRole === "student" || data.platformRole === "teacher"}
        <section class="flex flex-col gap-4 border-t border-border-subtle pt-4">
          <div class="flex flex-col gap-1">
            <h2 class="text-title-sm text-destructive">{m.account_delete_title()}</h2>
            <p class="text-body-sm text-muted-foreground">{m.account_delete_hint()}</p>
          </div>
          <form
            method="POST"
            action="?/deleteAccount"
            use:enhance={deleteSubmit}
            class="flex flex-col gap-3"
          >
            <label class="flex flex-col gap-1.5">
              <span class="text-caption text-muted-foreground">
                {m.account_delete_confirmLabel({ email: data.email })}
              </span>
              <Input
                name="confirmation"
                bind:value={deleteConfirmation}
                autocomplete="off"
                autocapitalize="none"
                spellcheck={false}
              />
            </label>
            {#if deleteError}
              <p class="text-body-sm text-destructive" role="alert">{deleteError}</p>
            {/if}
            <button
              type="submit"
              disabled={deleteBusy || !deleteArmed}
              class="inline-flex items-center gap-2 self-start rounded-md border border-destructive/40 px-3 py-1.5 text-caption font-medium text-destructive transition-colors duration-fast ease-out-soft hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 aria-hidden="true" class="size-4" />
              {m.account_delete_submit()}
            </button>
          </form>
        </section>
      {/if}

      <SecuritySettingsUnlockDialog
        bind:open={unlockOpen}
        hasPasskey={passkeyEnabled}
        hasSecurityFactor={data.hasSecurityFactor}
        hasTotp={data.hasTotp}
        onUnlocked={continueAfterUnlock}
      />
      <TwoFactorDialog
        bind:open={totpOpen}
        hasTotp={data.hasTotp}
        canRemove={data.canRemoveLastFactor || passkeyEnabled}
        returnTo={data.returnTo}
      />
      <PasskeyDialog bind:open={passkeyOpen} passkeys={data.passkeys} />
    </Card>
  </Section>
</PageContainer>

<NotificationPreferencesDialog
  bind:open={notificationsOpen}
  data={data.notificationForm}
  primaryEmail={data.email}
/>
