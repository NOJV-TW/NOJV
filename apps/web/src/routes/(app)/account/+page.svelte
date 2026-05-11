<script lang="ts">
  import { untrack } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { superForm } from "sveltekit-superforms/client";
  import { Check, Pencil, X } from "@lucide/svelte";
  import AvatarUploader from "$lib/components/account/AvatarUploader.svelte";
  import SchoolVerificationSection from "$lib/components/auth/SchoolVerification.svelte";
  import Section from "$lib/components/ui/Section.svelte";
  import { Card } from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import { toasts } from "$lib/stores/toast";
  import type { FormMessage } from "$lib/types/form-message";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  let editingName = $state(false);
  let editingUsername = $state(false);

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
          editingName = false;
        }
      }
    }
  );

  function cancelNameEdit() {
    $nameForm.name = data.name;
    editingName = false;
  }

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
          editingUsername = false;
        }
      }
    }
  );

  function cancelUsernameEdit() {
    $usernameForm.username = data.username === "—" ? "" : data.username;
    editingUsername = false;
  }

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
      <h1 class="text-title-lg">{m.navigation_account()}</h1>
      <p>{m.account_profileDescription()}</p>
    {/snippet}

    <div class="flex flex-col gap-6">
      <Card variant="surface" size="md">
        <div class="flex flex-col gap-1">
          <h2 class="text-title-sm">{m.account_profile()}</h2>
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
            <dd>
              {#if editingName}
                <form
                  method="POST"
                  action="?/updateName"
                  use:nameEnhance
                  class="flex flex-col gap-1.5"
                >
                  <div class="flex items-center gap-1.5">
                    <!-- svelte-ignore a11y_autofocus -->
                    <input
                      id="edit-name"
                      name="name"
                      type="text"
                      autocomplete="name"
                      bind:value={$nameForm.name}
                      class="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                      autofocus
                    />
                    <button
                      type="submit"
                      class="grid h-7 w-7 place-items-center rounded text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={$nameSubmitting}
                      aria-label={m.account_save()}
                      title={m.account_save()}
                    >
                      <Check class="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      class="grid h-7 w-7 place-items-center rounded text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
                      onclick={cancelNameEdit}
                      aria-label={m.account_cancel()}
                      title={m.account_cancel()}
                    >
                      <X class="h-4 w-4" />
                    </button>
                  </div>
                  {#if $nameErrors.name}
                    <p class="text-caption text-destructive">{m.account_nameRequired()}</p>
                  {:else if nameErrorText}
                    <p class="text-caption text-destructive">{nameErrorText}</p>
                  {/if}
                </form>
              {:else}
                <div class="flex items-center gap-2">
                  <span class="text-body font-medium">{data.name}</span>
                  <button
                    type="button"
                    class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
                    onclick={() => (editingName = true)}
                    aria-label={m.account_edit()}
                    title={m.account_edit()}
                  >
                    <Pencil class="h-3.5 w-3.5" />
                  </button>
                </div>
              {/if}
            </dd>
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
            <dd>
              {#if editingUsername}
                <form
                  method="POST"
                  action="?/updateUsername"
                  use:usernameEnhance
                  class="flex flex-col gap-1.5"
                >
                  <div class="flex items-center gap-1.5">
                    <!-- svelte-ignore a11y_autofocus -->
                    <input
                      id="edit-username"
                      name="username"
                      type="text"
                      autocomplete="username"
                      bind:value={$usernameForm.username}
                      class="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                      autofocus
                    />
                    <button
                      type="submit"
                      class="grid h-7 w-7 place-items-center rounded text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={$usernameSubmitting}
                      aria-label={m.account_save()}
                      title={m.account_save()}
                    >
                      <Check class="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      class="grid h-7 w-7 place-items-center rounded text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
                      onclick={cancelUsernameEdit}
                      aria-label={m.account_cancel()}
                      title={m.account_cancel()}
                    >
                      <X class="h-4 w-4" />
                    </button>
                  </div>
                  <p class="text-caption text-muted-foreground">
                    {m.account_usernameHelper()}
                  </p>
                  {#if $usernameErrors.username}
                    <p class="text-caption text-destructive">{m.account_usernameInvalid()}</p>
                  {:else if usernameErrorText}
                    <p class="text-caption text-destructive">{usernameErrorText}</p>
                  {/if}
                </form>
              {:else}
                <div class="flex items-center gap-2 text-body font-medium">
                  <span>{data.username}</span>
                  {#if data.isSchoolVerified}
                    <Badge variant="success" size="sm" dot>
                      {m.account_verifiedBadge()}
                    </Badge>
                  {/if}
                  {#if data.canEditUsername}
                    <button
                      type="button"
                      class="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground"
                      onclick={() => (editingUsername = true)}
                      aria-label={m.account_edit()}
                      title={m.account_edit()}
                    >
                      <Pencil class="h-3.5 w-3.5" />
                    </button>
                  {/if}
                </div>
                {#if usernameLockReason}
                  <p class="mt-1 text-caption text-muted-foreground">{usernameLockReason}</p>
                {/if}
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

      <SchoolVerificationSection isSchoolVerified={data.isSchoolVerified} />
    </div>
  </Section>
</div>
