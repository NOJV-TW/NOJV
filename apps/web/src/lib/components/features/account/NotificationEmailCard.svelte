<script lang="ts">
  import { enhance } from "$app/forms";
  import { m } from "$lib/paraglide/messages.js";
  import { actionErrorSchema } from "@nojv/core";
  import { toasts } from "$lib/stores/toast";
  import FormField from "$lib/components/primitives/ui/FormField.svelte";
  import { Input } from "$lib/components/primitives/ui/input";
  import { Button } from "$lib/components/primitives/ui/button";
  import { Badge } from "$lib/components/primitives/ui/badge";

  interface Props {
    primaryEmail: string;
    notificationEmail: string | null;
    verified: boolean;
  }

  let { primaryEmail, notificationEmail, verified }: Props = $props();

  let editing = $state(false);
  let email = $state("");
  let error = $state("");
  let loading = $state(false);
</script>

<div class="flex flex-col gap-3">
  <div class="flex items-start justify-between gap-4 rounded-md border border-border px-4 py-3">
    <div class="flex min-w-0 flex-col gap-1">
      <span class="text-caption uppercase tracking-wide text-muted-foreground">
        {m.account_notificationEmail_label()}
      </span>
      <span class="flex flex-wrap items-center gap-2 text-body font-medium break-all">
        {notificationEmail ?? primaryEmail}
        {#if notificationEmail && verified}
          <Badge variant="success" size="sm" dot>{m.account_verifiedBadge()}</Badge>
        {:else if !notificationEmail}
          <Badge variant="muted" size="sm">{m.account_notificationEmail_usingPrimary()}</Badge>
        {/if}
      </span>
    </div>
    <div class="flex shrink-0 gap-2">
      {#if !editing}
        <Button variant="outline" size="sm" onclick={() => (editing = true)}>
          {m.account_notificationEmail_change()}
        </Button>
      {/if}
      {#if notificationEmail}
        <form
          method="POST"
          action="?/clearNotificationEmail"
          use:enhance={() => {
            return async ({ update }) => {
              toasts.success(m.account_notificationEmail_cleared());
              await update();
            };
          }}
        >
          <Button variant="ghost" size="sm" type="submit">
            {m.account_notificationEmail_useLogin()}
          </Button>
        </form>
      {/if}
    </div>
  </div>

  {#if editing}
    <form
      method="POST"
      action="?/sendNotificationEmail"
      class="flex flex-col gap-3"
      use:enhance={() => {
        error = "";
        loading = true;
        return async ({ result, update }) => {
          loading = false;
          if (result.type === "success") {
            toasts.success(m.account_notificationEmail_sent());
            editing = false;
            email = "";
          } else if (result.type === "failure") {
            const parsed = actionErrorSchema.safeParse(result.data);
            error = parsed.success ? parsed.data.error : m.account_notificationEmail_failed();
          } else {
            await update();
          }
        };
      }}
    >
      <FormField
        label={m.account_notificationEmail_new()}
        hint={m.account_notificationEmail_hint()}
        {error}
        for="notification-email"
        required
      >
        <Input
          id="notification-email"
          name="email"
          type="email"
          autocomplete="email"
          bind:value={email}
          aria-invalid={!!error}
          required
        />
      </FormField>
      <div class="flex flex-wrap gap-2">
        <Button type="submit" disabled={loading} {loading}>
          {m.account_notificationEmail_send()}
        </Button>
        <Button variant="ghost" type="button" onclick={() => ((editing = false), (error = ""))}>
          {m.common_cancel()}
        </Button>
      </div>
    </form>
  {/if}
</div>
