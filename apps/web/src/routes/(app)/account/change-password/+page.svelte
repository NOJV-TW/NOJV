<script lang="ts">
  import { untrack } from "svelte";
  import { superForm } from "sveltekit-superforms/client";
  import { m } from "$lib/paraglide/messages.js";
  import Section from "$lib/components/primitives/ui/Section.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { Card } from "$lib/components/primitives/ui/card";
  import { toasts } from "$lib/stores/toast";
  import type { FormMessage } from "$lib/types/form-message";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const { form, errors, enhance, message, submitting } = superForm<
    typeof data.form.data,
    FormMessage
  >(
    untrack(() => data.form),
    {
      resetForm: false,
      taintedMessage: null,
      onUpdated({ form }) {
        if (form.message?.kind === "success") {
          toasts.success(m.account_changePassword_success());
        }
      },
    },
  );

  function fieldError(code: string | undefined): string | null {
    if (!code) return null;
    switch (code) {
      case "account_changePassword_tooShort":
        return m.account_changePassword_tooShort();
      case "account_changePassword_mismatch":
        return m.account_changePassword_mismatch();
      default:
        return code;
    }
  }

  const formError = $derived(
    $message?.kind === "error" ? m.account_changePassword_wrongCurrent() : null,
  );

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30";
</script>

<PageContainer width="form">
  <Section>
    {#snippet header()}
      <h1 class="text-title-lg">{m.account_changePassword_title()}</h1>
      <p>{m.account_changePassword_description()}</p>
    {/snippet}

    <Card variant="surface" size="md">
      {#if data.forced}
        <p
          class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-body-sm text-warning-foreground"
        >
          {m.account_changePassword_forcedNotice()}
        </p>
      {/if}

      <form method="POST" use:enhance class="flex flex-col gap-4">
        <label class="flex flex-col gap-1.5">
          <span class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.account_changePassword_current()}
          </span>
          <input
            name="currentPassword"
            type="password"
            autocomplete="current-password"
            bind:value={$form.currentPassword}
            aria-invalid={$errors.currentPassword ? "true" : undefined}
            class={inputClass}
          />
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.account_changePassword_new()}
          </span>
          <input
            name="newPassword"
            type="password"
            autocomplete="new-password"
            bind:value={$form.newPassword}
            aria-invalid={$errors.newPassword ? "true" : undefined}
            class={inputClass}
          />
          {#if fieldError($errors.newPassword?.[0])}
            <p class="text-caption text-destructive">{fieldError($errors.newPassword?.[0])}</p>
          {/if}
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="text-caption uppercase tracking-wide text-muted-foreground">
            {m.account_changePassword_confirm()}
          </span>
          <input
            name="confirmPassword"
            type="password"
            autocomplete="new-password"
            bind:value={$form.confirmPassword}
            aria-invalid={$errors.confirmPassword ? "true" : undefined}
            class={inputClass}
          />
          {#if fieldError($errors.confirmPassword?.[0])}
            <p class="text-caption text-destructive">
              {fieldError($errors.confirmPassword?.[0])}
            </p>
          {/if}
        </label>

        {#if formError}
          <p class="text-caption text-destructive">{formError}</p>
        {/if}

        <button
          type="submit"
          class="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-body-sm font-medium text-primary-foreground transition-colors duration-fast ease-out-soft hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={$submitting}
        >
          {m.account_changePassword_submit()}
        </button>
      </form>
    </Card>
  </Section>
</PageContainer>
