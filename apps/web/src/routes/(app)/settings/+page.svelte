<script lang="ts">
  import { untrack } from "svelte";
  import { page } from "$app/state";
  import { enhance } from "$app/forms";
  import { m } from "$lib/paraglide/messages.js";
  import {
    Bell,
    ChevronRight,
    Compass,
    Fingerprint,
    KeyRound,
    ShieldCheck,
  } from "@lucide/svelte";
  import { replayStudentTour } from "$lib/onboarding/student-tour";
  import { replayTeacherTour } from "$lib/onboarding/teacher-tour";
  import NotificationPreferencesDialog from "$lib/components/features/account/NotificationPreferencesDialog.svelte";
  import TwoFactorDialog from "$lib/components/features/account/TwoFactorDialog.svelte";
  import TwoFactorActivationDialog from "$lib/components/features/account/TwoFactorActivationDialog.svelte";
  import PasskeyDialog from "$lib/components/features/account/PasskeyDialog.svelte";
  import SchoolVerificationSection from "$lib/components/features/auth/SchoolVerification.svelte";
  import Section from "$lib/components/primitives/ui/Section.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { toasts } from "$lib/stores/toast";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  let notificationsOpen = $state(false);
  let totpOpen = $state(untrack(() => data.verifyAutoOpen));
  let passkeyOpen = $state(false);
  let activationOpen = $state(untrack(() => data.activateAutoOpen));

  const passkeyEnabled = $derived(data.passkeys.length > 0);

  let oauthBusy = $state(false);
  let oauthError = $state("");
  const providerLabel: Record<string, string> = { github: "GitHub", google: "Google" };

  const linkedCount = $derived(data.providers.filter((p) => p.linked).length);

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
      default:
        return m.account_connections_error_unexpected();
    }
  }

  const settingLinkClass =
    "group flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-body-sm font-medium transition-colors duration-fast ease-out-soft hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
  const settingChevronClass =
    "h-4 w-4 text-muted-foreground transition-transform duration-fast ease-out-soft group-hover:translate-x-0.5";
  const methodRowClass =
    "flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-body-sm font-medium";
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
          <h2 class="text-title-sm">{m.account_securityTitle()}</h2>
          <p class="text-body-sm text-muted-foreground">{m.account_verification_hint()}</p>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.account_email()}
          </span>
          <span class="text-body font-medium break-all">{data.email}</span>
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

          <div class={methodRowClass}>
            <span class="flex min-w-0 items-center gap-2.5">
              <ShieldCheck aria-hidden="true" class="h-4 w-4 shrink-0 text-muted-foreground" />
              <span class="truncate">{m.account_2fa_title()}</span>
              <Badge variant={data.twoFactorActivated ? "success" : "muted"} size="sm" dot>
                {data.twoFactorActivated
                  ? m.account_verification_statusEnabled()
                  : m.account_verification_statusInactive()}
              </Badge>
            </span>
            <button
              type="button"
              class={methodBtnClass}
              onclick={() => (activationOpen = true)}
            >
              {data.twoFactorActivated ? m.account_2fa_turnOff() : m.account_2fa_turnOn()}
            </button>
          </div>
          <p class="text-caption text-muted-foreground">{m.account_2fa_masterHint()}</p>

          <div class={methodRowClass} class:opacity-60={!data.twoFactorActivated}>
            <span class="flex min-w-0 items-center gap-2.5">
              <ShieldCheck aria-hidden="true" class="h-4 w-4 shrink-0 text-muted-foreground" />
              <span class="truncate">{m.account_verification_totp()}</span>
              <Badge variant={data.twoFactorEnabled ? "success" : "muted"} size="sm" dot>
                {data.twoFactorEnabled
                  ? m.account_verification_statusEnabled()
                  : m.account_verification_statusInactive()}
              </Badge>
            </span>
            <button
              type="button"
              class={methodBtnClass}
              disabled={!data.twoFactorActivated && !data.twoFactorEnabled}
              title={!data.twoFactorActivated && !data.twoFactorEnabled
                ? m.account_2fa_methodsLockedHint()
                : undefined}
              onclick={() => (totpOpen = true)}
            >
              {data.twoFactorEnabled
                ? m.account_verification_manage()
                : m.account_verification_setup()}
            </button>
          </div>

          <div class={methodRowClass} class:opacity-60={!data.twoFactorActivated}>
            <span class="flex min-w-0 items-center gap-2.5">
              <Fingerprint aria-hidden="true" class="h-4 w-4 shrink-0 text-muted-foreground" />
              <span class="truncate">Passkey</span>
              <Badge variant={passkeyEnabled ? "success" : "muted"} size="sm" dot>
                {passkeyEnabled
                  ? m.account_verification_statusEnabled()
                  : m.account_verification_statusInactive()}
              </Badge>
            </span>
            <button
              type="button"
              class={methodBtnClass}
              disabled={!data.twoFactorActivated && !passkeyEnabled}
              title={!data.twoFactorActivated && !passkeyEnabled
                ? m.account_2fa_methodsLockedHint()
                : undefined}
              onclick={() => (passkeyOpen = true)}
            >
              {passkeyEnabled
                ? m.account_verification_manage()
                : m.account_verification_setup()}
            </button>
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-4 border-t border-border-subtle pt-4">
        <div class="flex flex-col gap-1">
          <h2 class="text-title-sm">{m.account_connections_title()}</h2>
          <p class="text-body-sm text-muted-foreground">
            {m.account_connections_hint()}
          </p>
        </div>
        {#if oauthError}
          <p class="text-body-sm text-destructive" role="alert">{oauthError}</p>
        {/if}
        <div class="flex flex-col gap-3">
          {#each data.providers as { provider, linked } (provider)}
            {@const lastMethod = linked && linkedCount === 1 && !data.hasPassword}
            <div class="flex flex-col gap-1 rounded-md border border-border px-4 py-3">
              <div class="flex items-center justify-between gap-4">
                <span class="text-body-sm font-medium"
                  >{providerLabel[provider] ?? provider}</span
                >
                <form
                  method="POST"
                  action={linked ? "?/unlink" : "?/link"}
                  use:enhance={() => {
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
                          m.account_connections_unlinked({
                            provider: providerLabel[provider] ?? provider,
                          }),
                        );
                      }
                      await update();
                    };
                  }}
                >
                  <input type="hidden" name="provider" value={provider} />
                  <button
                    type="submit"
                    disabled={oauthBusy || lastMethod}
                    title={lastMethod ? m.account_connections_lastMethodHint() : undefined}
                    class="rounded-md border px-3 py-1.5 text-caption font-medium disabled:cursor-not-allowed disabled:opacity-50 {linked
                      ? 'border-destructive/40 text-destructive'
                      : 'border-border'}"
                  >
                    {linked ? m.account_connections_unlink() : m.account_connections_link()}
                  </button>
                </form>
              </div>
              {#if lastMethod}
                <p class="text-caption text-muted-foreground">
                  {m.account_connections_lastMethodHint()}
                </p>
              {/if}
            </div>
          {/each}
        </div>
      </section>

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
              const sessionUser = page.data.user;
              if (!sessionUser) return;
              if (data.platformRole === "teacher") replayTeacherTour(sessionUser.id);
              else replayStudentTour(sessionUser.id);
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

      <TwoFactorActivationDialog
        bind:open={activationOpen}
        activated={data.twoFactorActivated}
        twoFactorEnabled={data.twoFactorEnabled}
        hasPasskey={passkeyEnabled}
      />
      <TwoFactorDialog
        bind:open={totpOpen}
        twoFactorEnabled={data.twoFactorEnabled}
        hasPassword={data.hasPassword}
        returnTo={data.returnTo}
      />
      <PasskeyDialog
        bind:open={passkeyOpen}
        activated={data.twoFactorActivated}
        passkeys={data.passkeys}
      />
    </Card>
  </Section>
</PageContainer>

<NotificationPreferencesDialog bind:open={notificationsOpen} data={data.notificationForm} />
