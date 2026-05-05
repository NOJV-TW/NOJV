<script lang="ts">
  import { untrack } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { superForm } from "sveltekit-superforms/client";
  import AvatarUploader from "$lib/components/account/AvatarUploader.svelte";
  import SchoolVerificationSection from "$lib/components/auth/SchoolVerification.svelte";
  import Section from "$lib/components/ui/Section.svelte";
  import { Card } from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { toasts } from "$lib/stores/toast";
  import type { FormMessage } from "$lib/types/form-message";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  // Map server-returned error codes to i18n strings. Username/name share most codes.
  function mapCode(code: string): string {
    switch (code) {
      case "VERIFIED_LOCKED":
        return m.account_usernameLockedByVerification();
      case "PLACEHOLDER_LOCKED":
        return m.account_usernameLockedByPlaceholder();
      case "TAKEN":
        return m.account_usernameTaken();
      case "RESERVED_FORMAT":
        return m.account_usernameReserved();
      case "INVALID_FORMAT":
        return m.account_usernameInvalid();
      case "INVALID_NAME":
        return m.account_nameRequired();
      default:
        return code;
    }
  }

  // --- Name form ---
  const {
    form: nameForm,
    errors: nameErrors,
    enhance: nameEnhance,
    message: nameMessage,
    submitting: nameSubmitting
  } = superForm<typeof data.nameForm.data, FormMessage>(
    untrack(() => data.nameForm),
    {
      resetForm: false,
      taintedMessage: null,
      onUpdated({ form }) {
        if (form.message?.kind === "success") {
          toasts.success(m.account_nameUpdated());
        }
      }
    }
  );

  const nameErrorText = $derived(
    $nameMessage?.kind === "error" ? mapCode($nameMessage.text) : null
  );

  // --- Username form ---
  const {
    form: usernameForm,
    errors: usernameErrors,
    enhance: usernameEnhance,
    message: usernameMessage,
    submitting: usernameSubmitting
  } = superForm<typeof data.usernameForm.data, FormMessage>(
    untrack(() => data.usernameForm),
    {
      resetForm: false,
      taintedMessage: null,
      onUpdated({ form }) {
        if (form.message?.kind === "success") {
          if (form.message.text === "MERGED") {
            toasts.success(m.account_mergedWithInvite());
          } else {
            toasts.success(m.account_usernameUpdated());
          }
        }
      }
    }
  );

  const usernameErrorText = $derived(
    $usernameMessage?.kind === "error" ? mapCode($usernameMessage.text) : null
  );

  const usernameLockReason = $derived(
    data.canEditUsername
      ? null
      : data.isSchoolVerified
        ? m.account_usernameLockedByVerification()
        : m.account_usernameLockedByPlaceholder()
  );
</script>

<div class="mx-auto w-full max-w-2xl">
  <Section>
    {#snippet header()}
      <h1 class="font-display text-title-lg">{m.navigation_account()}</h1>
      <p>{m.account_profileDescription()}</p>
    {/snippet}

    <div class="flex flex-col gap-6">
      <Card variant="surface" size="md">
        <div class="flex flex-col gap-1">
          <h2 class="font-display text-title-sm">{m.account_profile()}</h2>
          <p class="text-body-sm text-muted-foreground">
            {m.account_profileHint()}
          </p>
        </div>

        <AvatarUploader image={data.image} name={data.name} />

        <dl class="grid gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-1">
            <dt class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.account_name()}
            </dt>
            <dd class="text-body font-medium">{data.name}</dd>
          </div>
          <div class="flex flex-col gap-1">
            <dt class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.account_email()}
            </dt>
            <dd class="text-body font-medium break-all">{data.email}</dd>
          </div>
          <div class="flex flex-col gap-1">
            <dt class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.account_userAccount()}
            </dt>
            <dd class="flex items-center gap-2 text-body font-medium">
              <span>{data.username}</span>
              {#if data.isSchoolVerified}
                <Badge variant="success" size="sm" dot>
                  {m.account_verifiedBadge()}
                </Badge>
              {/if}
            </dd>
          </div>
          <div class="flex flex-col gap-1">
            <dt class="text-caption uppercase tracking-wide text-muted-foreground">
              {m.account_role()}
            </dt>
            <dd>
              <Badge variant="muted" size="sm">{data.platformRole}</Badge>
            </dd>
          </div>
        </dl>
      </Card>

      <Card variant="surface" size="md">
        <div class="flex flex-col gap-1">
          <h2 class="font-display text-title-sm">{m.account_editProfile()}</h2>
          <p class="text-body-sm text-muted-foreground">{m.account_editProfileHint()}</p>
        </div>

        <form
          method="POST"
          action="?/updateName"
          use:nameEnhance
          class="flex flex-col gap-2"
        >
          <label for="edit-name" class="text-body-sm font-medium">
            {m.account_editName()}
          </label>
          <input
            id="edit-name"
            name="name"
            type="text"
            autocomplete="name"
            bind:value={$nameForm.name}
            class="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
          {#if $nameErrors.name}
            <p class="text-caption text-destructive">{m.account_nameRequired()}</p>
          {:else if nameErrorText}
            <p class="text-caption text-destructive">{nameErrorText}</p>
          {/if}
          <div class="flex justify-end">
            <Button type="submit" disabled={$nameSubmitting}>
              {$nameSubmitting ? m.account_saving() : m.account_save()}
            </Button>
          </div>
        </form>

        <form
          method="POST"
          action="?/updateUsername"
          use:usernameEnhance
          class="flex flex-col gap-2"
        >
          <label for="edit-username" class="text-body-sm font-medium">
            {m.account_editUsername()}
          </label>
          <input
            id="edit-username"
            name="username"
            type="text"
            autocomplete="username"
            disabled={!data.canEditUsername}
            bind:value={$usernameForm.username}
            class="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <p class="text-caption text-muted-foreground">
            {m.account_usernameHelper()}
          </p>
          {#if usernameLockReason}
            <p class="text-caption text-muted-foreground">{usernameLockReason}</p>
          {/if}
          {#if $usernameErrors.username}
            <p class="text-caption text-destructive">{m.account_usernameInvalid()}</p>
          {:else if usernameErrorText}
            <p class="text-caption text-destructive">{usernameErrorText}</p>
          {/if}
          <div class="flex justify-end">
            <Button type="submit" disabled={!data.canEditUsername || $usernameSubmitting}>
              {$usernameSubmitting ? m.account_saving() : m.account_save()}
            </Button>
          </div>
        </form>
      </Card>

      <SchoolVerificationSection isSchoolVerified={data.isSchoolVerified} />
    </div>
  </Section>
</div>
