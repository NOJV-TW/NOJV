<script lang="ts">
  import { untrack } from "svelte";
  import { applyAction, enhance as kitEnhance } from "$app/forms";
  import { AlertTriangle, Copy, Eye, Info, Save, Settings, Trash2 } from "@lucide/svelte";
  import { superForm } from "sveltekit-superforms/client";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/ui/button";
  import FormError from "$lib/components/ui/FormError.svelte";
  import type { FormMessage } from "$lib/types/form-message";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const {
    form: updateForm,
    errors,
    enhance,
    message: updateMessage,
    submitting: updateSubmitting
  } = superForm<typeof data.form.data, FormMessage>(
    untrack(() => data.form),
    { resetForm: false, taintedMessage: null }
  );

  // Danger-zone state — typed confirmation text must match the course title
  // before the destructive button unlocks.
  let typedConfirmation = $state("");
  let deleting = $state(false);
  let copying = $state(false);

  const courseTitle = $derived(data.form.data.title);
  const canDelete = $derived(typedConfirmation === courseTitle && courseTitle.length > 0);

  // Narrow the ActionData union to only the fields the danger zone sends
  // back so the template can refer to `form?.error` without TS complaints.
  // `updateInfo` returns `{ form }` and has no overlap with the danger-zone
  // fail payloads, so route via `unknown` to force the cast.
  type DangerFormResult = { error?: string } | null;
  const dangerResult = $derived(form as unknown as DangerFormResult);

  const updateErrorText = $derived(
    $updateMessage?.kind === "error" ? $updateMessage.text : null
  );
  const updateSuccess = $derived($updateMessage?.kind === "success");

  function resolveDangerBanner(result: DangerFormResult): string | null {
    if (!result?.error) return null;
    switch (result.error) {
      case "delete_mismatch":
        return m.courseSettings_deleteMismatchError();
      case "copy_unavailable":
        return m.courseSettings_copyUnavailable();
      default:
        return result.error;
    }
  }

  const dangerBanner = $derived(resolveDangerBanner(dangerResult));
</script>

<div class="mx-auto w-full max-w-[860px] space-y-6 pb-24">
  <!-- 1. Course info -->
  <section
    class="animate-in animate-in-1 rounded-2xl border border-border bg-[color:var(--color-panel)] p-7 shadow-rest backdrop-blur-sm"
  >
    <div class="mb-6 flex items-start gap-3.5">
      <span
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <Settings class="h-5 w-5" />
      </span>
      <div>
        <h2 class="font-display text-title-sm font-medium tracking-[-0.01em]">
          {m.courseSettings_infoCardTitle()}
        </h2>
        <p class="mt-1 text-caption text-muted-foreground">
          {m.courseSettings_infoCardDesc()}
        </p>
      </div>
    </div>

    <form method="POST" action="?/updateInfo" use:enhance class="space-y-0">
      <FormError message={updateErrorText} />

      {#if updateSuccess}
        <div
          role="status"
          aria-live="polite"
          class="mb-4 flex items-start gap-3 rounded-lg border border-success/30 border-l-4 border-l-success bg-success/10 px-4 py-3 text-success"
        >
          <Info class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p class="text-body-sm font-medium leading-snug">
            {m.courseSettings_saveSuccess()}
          </p>
        </div>
      {/if}

      <div
        class="grid grid-cols-1 items-start gap-4 border-b border-border-subtle py-4 md:grid-cols-[220px_1fr] md:gap-6"
      >
        <label for="title" class="text-body-sm font-medium leading-tight md:pt-2.5">
          {m.courseSettings_titleLabel()}
          <span class="mt-0.5 block text-caption font-normal text-muted-foreground">
            {m.courseSettings_titleLabelDesc()}
          </span>
        </label>
        <div>
          <input
            id="title"
            name="title"
            type="text"
            bind:value={$updateForm.title}
            class="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
          {#if $errors.title}
            <p class="mt-1 text-caption text-destructive">{$errors.title}</p>
          {/if}
        </div>
      </div>

      <div class="grid grid-cols-1 items-start gap-4 py-4 md:grid-cols-[220px_1fr] md:gap-6">
        <label for="description" class="text-body-sm font-medium leading-tight md:pt-2.5">
          {m.courseSettings_descriptionLabel()}
          <span class="mt-0.5 block text-caption font-normal text-muted-foreground">
            {m.courseSettings_descriptionLabelDesc()}
          </span>
        </label>
        <div>
          <textarea
            id="description"
            name="description"
            rows="3"
            bind:value={$updateForm.description}
            class="min-h-24 w-full resize-y rounded-lg border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          ></textarea>
          {#if $errors.description}
            <p class="mt-1 text-caption text-destructive">{$errors.description}</p>
          {/if}
        </div>
      </div>

      <div class="flex items-center justify-end gap-3 pt-4">
        <Button type="submit" disabled={$updateSubmitting}>
          <Save class="h-4 w-4" aria-hidden="true" />
          {m.courseSettings_saveButton()}
        </Button>
      </div>
    </form>
  </section>

  <!-- 2. Default policies — placeholder -->
  <section
    class="animate-in animate-in-2 rounded-2xl border border-border bg-[color:var(--color-panel)] p-7 shadow-rest backdrop-blur-sm"
  >
    <div class="mb-6 flex items-start gap-3.5">
      <span
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <Info class="h-5 w-5" />
      </span>
      <div>
        <h2 class="font-display text-title-sm font-medium tracking-[-0.01em]">
          {m.courseSettings_policiesCardTitle()}
        </h2>
        <p class="mt-1 text-caption text-muted-foreground">
          {m.courseSettings_policiesCardDesc()}
        </p>
      </div>
    </div>

    <div
      class="rounded-md border border-dashed border-border-strong bg-[color:var(--color-panel)]/40 px-5 py-6 text-body-sm text-muted-foreground"
    >
      {m.courseSettings_policiesPlaceholder()}
    </div>
  </section>

  <!-- 3. Visibility — placeholder -->
  <section
    class="animate-in animate-in-3 rounded-2xl border border-border bg-[color:var(--color-panel)] p-7 shadow-rest backdrop-blur-sm"
  >
    <div class="mb-6 flex items-start gap-3.5">
      <span
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <Eye class="h-5 w-5" />
      </span>
      <div>
        <h2 class="font-display text-title-sm font-medium tracking-[-0.01em]">
          {m.courseSettings_visibilityCardTitle()}
        </h2>
        <p class="mt-1 text-caption text-muted-foreground">
          {m.courseSettings_visibilityCardDesc()}
        </p>
      </div>
    </div>

    <div
      class="rounded-md border border-dashed border-border-strong bg-[color:var(--color-panel)]/40 px-5 py-6 text-body-sm text-muted-foreground"
    >
      {m.courseSettings_visibilityPlaceholder()}
    </div>
  </section>

  <!-- 4. Danger zone -->
  <section
    class="animate-in animate-in-4 rounded-2xl border p-7"
    style="background: rgba(184, 55, 42, 0.04); border-color: rgba(184, 55, 42, 0.28);"
  >
    <div class="mb-6 flex items-start gap-3.5">
      <span
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-destructive"
        style="background: rgba(184, 55, 42, 0.12);"
        aria-hidden="true"
      >
        <AlertTriangle class="h-5 w-5" />
      </span>
      <div>
        <h2 class="font-display text-title-sm font-medium tracking-[-0.01em] text-destructive">
          {m.courseSettings_dangerCardTitle()}
        </h2>
        <p class="mt-1 text-caption text-muted-foreground">
          {m.courseSettings_dangerCardDesc()}
        </p>
      </div>
    </div>

    {#if dangerBanner}
      <div
        role="alert"
        aria-live="polite"
        class="mb-4 flex items-start gap-3 rounded-lg border border-destructive/40 border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 text-destructive"
      >
        <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p class="text-body-sm font-medium leading-snug">{dangerBanner}</p>
      </div>
    {/if}

    <!-- Copy row -->
    <div
      class="grid grid-cols-1 items-start gap-4 py-5 md:grid-cols-[1fr_auto] md:gap-6"
      style="border-bottom: 1px solid rgba(184, 55, 42, 0.18);"
    >
      <div>
        <h3 class="text-body-lg font-semibold tracking-[-0.005em]">
          {m.courseSettings_copyTitle()}
        </h3>
        <p class="mt-1.5 text-caption leading-relaxed text-muted-foreground">
          {m.courseSettings_copyDesc()}
        </p>
      </div>
      <form
        method="POST"
        action="?/copyCourse"
        use:kitEnhance={() => {
          copying = true;
          return async ({ result, update }) => {
            copying = false;
            await applyAction(result);
            await update({ reset: false });
          };
        }}
      >
        <Button type="submit" variant="outline" disabled={copying}>
          <Copy class="h-4 w-4" aria-hidden="true" />
          {m.courseSettings_copyButton()}
        </Button>
      </form>
    </div>

    <!-- Delete row -->
    <div class="grid grid-cols-1 items-start gap-4 py-5 md:grid-cols-[1fr_auto] md:gap-6">
      <div>
        <h3 class="text-body-lg font-semibold tracking-[-0.005em]">
          {m.courseSettings_deleteTitle()}
        </h3>
        <p class="mt-1.5 text-caption leading-relaxed text-muted-foreground">
          {m.courseSettings_deleteDesc()}
        </p>

        <form
          method="POST"
          action="?/deleteCourse"
          use:kitEnhance={() => {
            deleting = true;
            return async ({ result, update }) => {
              deleting = false;
              await applyAction(result);
              await update({ reset: false });
            };
          }}
          class="mt-3 rounded-md border border-dashed bg-[color:var(--color-panel)] px-4 py-3.5"
          style="border-color: rgba(184, 55, 42, 0.32);"
        >
          <label
            for="typedConfirmation"
            class="text-caption font-medium text-muted-foreground"
          >
            {m.courseSettings_deleteConfirmLabel({ title: courseTitle })}
          </label>
          <input
            id="typedConfirmation"
            name="typedConfirmation"
            type="text"
            bind:value={typedConfirmation}
            placeholder={courseTitle}
            class="mt-1.5 w-full rounded-sm border border-border bg-transparent px-3 py-2 font-mono text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            autocomplete="off"
          />
          <div class="mt-3 flex items-center justify-end">
            <Button
              type="submit"
              variant="destructive"
              disabled={!canDelete || deleting}
            >
              <Trash2 class="h-4 w-4" aria-hidden="true" />
              {m.courseSettings_deleteButton()}
            </Button>
          </div>
        </form>
      </div>
    </div>
  </section>
</div>
