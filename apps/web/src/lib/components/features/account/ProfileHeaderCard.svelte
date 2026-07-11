<script lang="ts">
  import { untrack } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { superForm } from "sveltekit-superforms/client";
  import type { SuperValidated } from "sveltekit-superforms";
  import { Check, EyeOff, Pencil, X } from "@lucide/svelte";
  import AvatarUploader from "$lib/components/features/account/AvatarUploader.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import { toasts } from "$lib/stores/toast";
  import type { FormMessage } from "$lib/types/form-message";

  interface Owner {
    platformRole: string;
    isSchoolVerified: boolean;
    canEditUsername: boolean;
    nameForm: SuperValidated<{ name: string }>;
    usernameForm: SuperValidated<{ username: string }>;
  }

  interface Props {
    owner: Owner;
    name: string;
    username: string | null;
    image: string | null;
    profilePublic: boolean;
    joinedDate: string;
    solvedCount: number;
  }

  let { owner, name, username, image, profilePublic, joinedDate, solvedCount }: Props =
    $props();

  let editingName = $state(false);
  let editingUsername = $state(false);

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

  function roleLabel(role: string): string {
    switch (role) {
      case "admin":
        return m.common_roleAdmin();
      case "teacher":
        return m.common_roleTeacher();
      case "student":
        return m.common_roleStudent();
      default:
        return role;
    }
  }

  const {
    form: nameForm,
    errors: nameErrors,
    enhance: nameEnhance,
    message: nameMessage,
    submitting: nameSubmitting,
  } = superForm<{ name: string }, FormMessage>(
    untrack(() => owner.nameForm),
    {
      resetForm: false,
      taintedMessage: null,
      onUpdated({ form }) {
        if (form.message?.kind === "success") {
          toasts.success(m.account_nameUpdated());
          editingName = false;
        }
      },
    },
  );

  function cancelNameEdit() {
    $nameForm.name = name;
    editingName = false;
  }

  const nameErrorText = $derived(
    $nameMessage?.kind === "error" ? mapCode($nameMessage.text) : null,
  );

  const {
    form: usernameForm,
    errors: usernameErrors,
    enhance: usernameEnhance,
    message: usernameMessage,
    submitting: usernameSubmitting,
  } = superForm<{ username: string }, FormMessage>(
    untrack(() => owner.usernameForm),
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
      },
    },
  );

  function cancelUsernameEdit() {
    $usernameForm.username = username ?? "";
    editingUsername = false;
  }

  const usernameErrorText = $derived(
    $usernameMessage?.kind === "error" ? mapCode($usernameMessage.text) : null,
  );

  const usernameLockReason = $derived(
    owner.canEditUsername
      ? null
      : owner.isSchoolVerified
        ? m.account_usernameLockedByVerification()
        : m.account_usernameLockedByPlaceholder(),
  );

  const iconBtnClass =
    "grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors duration-fast ease-out-soft hover:bg-accent hover:text-foreground";
  const inputClass =
    "min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
</script>

<Card variant="surface" size="lg">
  <div class="flex flex-wrap items-center gap-5">
    <AvatarUploader {image} {name} />
    <div class="min-w-0 flex-1">
      {#if editingName}
        <form
          method="POST"
          action="?/updateName"
          use:nameEnhance
          class="flex max-w-sm flex-col gap-1.5"
        >
          <div class="flex items-center gap-1.5">
            <!-- svelte-ignore a11y_autofocus -->
            <input
              id="edit-name"
              name="name"
              type="text"
              autocomplete="name"
              bind:value={$nameForm.name}
              class={inputClass}
              autofocus
            />
            <button
              type="submit"
              class="{iconBtnClass} disabled:cursor-not-allowed disabled:opacity-50"
              disabled={$nameSubmitting}
              aria-label={m.account_save()}
              title={m.account_save()}
            >
              <Check aria-hidden="true" class="h-4 w-4" />
            </button>
            <button
              type="button"
              class={iconBtnClass}
              onclick={cancelNameEdit}
              aria-label={m.account_cancel()}
              title={m.account_cancel()}
            >
              <X aria-hidden="true" class="h-4 w-4" />
            </button>
          </div>
          {#if $nameErrors.name}
            <p class="text-caption text-destructive">{m.account_nameRequired()}</p>
          {:else if nameErrorText}
            <p class="text-caption text-destructive">{nameErrorText}</p>
          {/if}
        </form>
      {:else}
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="text-headline font-semibold leading-tight">{name}</h1>
          <button
            type="button"
            class={iconBtnClass}
            onclick={() => (editingName = true)}
            aria-label={m.account_edit()}
            title={m.account_edit()}
          >
            <Pencil aria-hidden="true" class="h-3.5 w-3.5" />
          </button>
          <Badge variant="muted" size="sm">{roleLabel(owner.platformRole)}</Badge>
          {#if !profilePublic}
            <span
              class="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-0.5 text-caption font-medium text-muted-foreground"
            >
              <EyeOff class="size-3.5" />
              {m.userProfile_privateBadge()}
            </span>
          {/if}
        </div>
      {/if}

      {#if editingUsername}
        <form
          method="POST"
          action="?/updateUsername"
          use:usernameEnhance
          class="mt-1.5 flex max-w-sm flex-col gap-1.5"
        >
          <div class="flex items-center gap-1.5">
            <!-- svelte-ignore a11y_autofocus -->
            <input
              id="edit-username"
              name="username"
              type="text"
              autocomplete="username"
              bind:value={$usernameForm.username}
              class={inputClass}
              autofocus
            />
            <button
              type="submit"
              class="{iconBtnClass} disabled:cursor-not-allowed disabled:opacity-50"
              disabled={$usernameSubmitting}
              aria-label={m.account_save()}
              title={m.account_save()}
            >
              <Check aria-hidden="true" class="h-4 w-4" />
            </button>
            <button
              type="button"
              class={iconBtnClass}
              onclick={cancelUsernameEdit}
              aria-label={m.account_cancel()}
              title={m.account_cancel()}
            >
              <X aria-hidden="true" class="h-4 w-4" />
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
        <div class="mt-0.5 flex flex-wrap items-center gap-2">
          <span class="font-mono text-body-sm text-muted-foreground">
            {username ? `@${username}` : "—"}
          </span>
          {#if owner.isSchoolVerified}
            <Badge variant="success" size="sm" dot>
              {m.account_verifiedBadge()}
            </Badge>
          {/if}
          {#if owner.canEditUsername}
            <button
              type="button"
              class={iconBtnClass}
              onclick={() => (editingUsername = true)}
              aria-label={m.account_edit()}
              title={m.account_edit()}
            >
              <Pencil aria-hidden="true" class="h-3.5 w-3.5" />
            </button>
          {/if}
        </div>
        {#if usernameLockReason}
          <p class="mt-0.5 text-caption text-muted-foreground">{usernameLockReason}</p>
        {/if}
      {/if}

      <p class="mt-1 text-caption text-muted-foreground">
        {m.userProfile_joined({ date: joinedDate })}
      </p>
    </div>
    <div class="flex flex-col items-end gap-0.5">
      <span class="text-headline font-semibold tabular-nums">{solvedCount}</span>
      <span class="text-caption text-muted-foreground">{m.userProfile_solvedCount()}</span>
    </div>
  </div>
  {#if !profilePublic}
    <p class="mt-4 border-t border-border-subtle pt-4 text-caption text-muted-foreground">
      {m.userProfile_privateHint()}
    </p>
  {/if}
</Card>
