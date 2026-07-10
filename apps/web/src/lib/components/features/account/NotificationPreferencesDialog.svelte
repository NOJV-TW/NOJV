<script lang="ts">
  import { untrack } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import type { NotificationPreferences } from "@nojv/core";
  import * as Dialog from "$lib/components/primitives/ui/dialog";
  import ToggleSwitch from "$lib/components/primitives/ui/ToggleSwitch.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { toasts } from "$lib/stores/toast";
  import type { FormMessage } from "$lib/types/form-message";

  interface Props {
    open: boolean;
    data: SuperValidated<NotificationPreferences, FormMessage>;
  }

  let { open = $bindable(false), data }: Props = $props();

  const { form, enhance, submitting } = superForm<NotificationPreferences, FormMessage>(
    untrack(() => data),
    {
      dataType: "json",
      resetForm: false,
      taintedMessage: null,
      onUpdated({ form }) {
        if (form.message?.kind === "success") {
          toasts.success(m.account_notifications_saved());
          void invalidateAll();
          open = false;
        } else if (!form.valid) {
          toasts.error(m.account_notifications_saveFailed());
        }
      },
    },
  );

  const leadDaysClass =
    "w-16 rounded-md border border-border bg-background px-2 py-1 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50";
</script>

<Dialog.Root bind:open>
  <Dialog.Content showCloseButton class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{m.account_notifications_title()}</Dialog.Title>
      <Dialog.Description>{m.account_notifications_dialogHint()}</Dialog.Description>
    </Dialog.Header>

    <form
      method="POST"
      action="?/updateNotificationPreferences"
      use:enhance
      class="flex flex-col gap-6"
    >
      <section class="flex flex-col gap-3">
        <h3 class="text-caption uppercase tracking-wide text-muted-foreground">
          {m.account_notifications_groupAssignments()}
        </h3>
        <div class="flex items-center justify-between gap-4">
          <span class="text-body-sm">{m.account_notifications_assignmentStarted()}</span>
          <ToggleSwitch bind:checked={$form.emailAssignmentStarted} />
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-4">
            <span class="text-body-sm">{m.account_notifications_assignmentDueSoon()}</span>
            <ToggleSwitch bind:checked={$form.emailAssignmentDueSoon} />
          </div>
          <label
            class="flex items-center justify-between gap-4 text-caption text-muted-foreground"
          >
            <span>{m.account_notifications_leadDays()}</span>
            <input
              type="number"
              min="1"
              max="7"
              class={leadDaysClass}
              bind:value={$form.assignmentDueSoonLeadDays}
              disabled={!$form.emailAssignmentDueSoon}
            />
          </label>
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <h3 class="text-caption uppercase tracking-wide text-muted-foreground">
          {m.account_notifications_groupExams()}
        </h3>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-4">
            <span class="text-body-sm">{m.account_notifications_examStarting()}</span>
            <ToggleSwitch bind:checked={$form.emailExamStarting} />
          </div>
          <label
            class="flex items-center justify-between gap-4 text-caption text-muted-foreground"
          >
            <span>{m.account_notifications_leadDays()}</span>
            <input
              type="number"
              min="1"
              max="7"
              class={leadDaysClass}
              bind:value={$form.examStartingLeadDays}
              disabled={!$form.emailExamStarting}
            />
          </label>
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <h3 class="text-caption uppercase tracking-wide text-muted-foreground">
          {m.account_notifications_groupContests()}
        </h3>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-4">
            <span class="text-body-sm">{m.account_notifications_contestStarting()}</span>
            <ToggleSwitch bind:checked={$form.emailContestStarting} />
          </div>
          <label
            class="flex items-center justify-between gap-4 text-caption text-muted-foreground"
          >
            <span>{m.account_notifications_leadDays()}</span>
            <input
              type="number"
              min="1"
              max="7"
              class={leadDaysClass}
              bind:value={$form.contestStartingLeadDays}
              disabled={!$form.emailContestStarting}
            />
          </label>
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <h3 class="text-caption uppercase tracking-wide text-muted-foreground">
          {m.account_notifications_groupAnnouncements()}
        </h3>
        <div class="flex items-center justify-between gap-4">
          <span class="text-body-sm">{m.account_notifications_systemAnnouncement()}</span>
          <ToggleSwitch bind:checked={$form.emailSystemAnnouncement} />
        </div>
        <div class="flex items-center justify-between gap-4">
          <span class="text-body-sm">{m.account_notifications_courseAnnouncement()}</span>
          <ToggleSwitch bind:checked={$form.emailCourseAnnouncement} />
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <h3 class="text-caption uppercase tracking-wide text-muted-foreground">
          {m.account_notifications_groupOther()}
        </h3>
        <div class="flex items-center justify-between gap-4">
          <span class="text-body-sm">{m.account_notifications_courseEnrolled()}</span>
          <ToggleSwitch bind:checked={$form.emailCourseEnrolled} />
        </div>
        <div class="flex items-center justify-between gap-4">
          <span class="text-body-sm">{m.account_notifications_roleChanged()}</span>
          <ToggleSwitch bind:checked={$form.emailRoleChanged} />
        </div>
        <div class="flex items-center justify-between gap-4">
          <span class="text-body-sm">{m.account_notifications_editorialRemoved()}</span>
          <ToggleSwitch bind:checked={$form.emailEditorialRemoved} />
        </div>
      </section>

      <p class="text-caption text-muted-foreground">
        {m.account_notifications_emailOnlyHint()}
      </p>

      <Dialog.Footer>
        <button
          type="button"
          class="inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-sm font-medium transition hover:bg-muted"
          onclick={() => (open = false)}
          disabled={$submitting}
        >
          {m.account_cancel()}
        </button>
        <button
          type="submit"
          class="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={$submitting}
        >
          {$submitting ? m.common_saving() : m.common_save()}
        </button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
