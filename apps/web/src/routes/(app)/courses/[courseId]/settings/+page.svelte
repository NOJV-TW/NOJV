<script lang="ts">
  import { untrack } from "svelte";
  import { applyAction, enhance as kitEnhance } from "$app/forms";
  import {
    AlertTriangle,
    Archive,
    ArchiveRestore,
    Copy,
    Info,
    Save,
    Settings,
    Trash2
  } from "@lucide/svelte";
  import { superForm } from "sveltekit-superforms/client";
  import { m } from "$lib/paraglide/messages.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Button } from "$lib/components/ui/button";
  import FormError from "$lib/components/ui/FormError.svelte";
  import { inputClassName } from "$lib/utils";
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
  let copyOpen = $state(false);
  let copyTitleInput = $state(untrack(() => data.copyPreview?.suggestedTitle ?? ""));
  $effect(() => {
    if (copyOpen && data.copyPreview) {
      copyTitleInput = data.copyPreview.suggestedTitle;
    }
  });
  let archiveSubmitting = $state(false);
  // Mirror server state locally so the toggle reflects the latest action
  // result without waiting for full page reload (kit's `update()` handles
  // the eventual sync). Initial read is wrapped in `untrack` so Svelte
  // doesn't warn about capturing-but-not-reactively-following `data`.
  let archivedLocal = $state(untrack(() => data.archived));
  $effect(() => {
    archivedLocal = data.archived;
  });

  const courseTitle = $derived(data.form.data.title);
  const canDelete = $derived(typedConfirmation === courseTitle && courseTitle.length > 0);

  const updateErrorText = $derived(
    $updateMessage?.kind === "error" ? $updateMessage.text : null
  );
  const updateSuccess = $derived($updateMessage?.kind === "success");

  // `form` is a discriminated union across every action (updateInfo /
  // deleteCourse / archiveCourse...). Narrow via property check instead
  // of a double-cast.
  function resolveDangerBanner(actionResult: ActionData): string | null {
    if (actionResult == null || !("error" in actionResult)) return null;
    const errorCode = actionResult.error;
    if (typeof errorCode !== "string") return null;
    if (errorCode === "delete_mismatch") return m.courseSettings_deleteMismatchError();
    return errorCode;
  }

  const dangerBanner = $derived(resolveDangerBanner(form));
</script>

<div class="mx-auto w-full max-w-[860px] space-y-6 pb-24">
  <!-- 1. Course info -->
  <section
    class="animate-in animate-in-1 rounded-xl border border-border bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur-sm"
  >
    <div class="mb-6 flex items-start gap-3.5">
      <span
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <Settings class="h-5 w-5" />
      </span>
      <div>
        <h2 class="text-title-sm font-medium tracking-[-0.01em]">
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
          class="mb-4 flex items-start gap-3 rounded-md border border-success/30 border-l-4 border-l-success bg-success/10 px-4 py-3 text-success"
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
            class="w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
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
            class="min-h-24 w-full resize-y rounded-md border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          ></textarea>
          {#if $errors.description}
            <p class="mt-1 text-caption text-destructive">{$errors.description}</p>
          {/if}
        </div>
      </div>

      <div
        class="grid grid-cols-1 items-start gap-4 border-b border-border-subtle py-4 md:grid-cols-[220px_1fr] md:gap-6"
      >
        <div class="text-body-sm font-medium leading-tight md:pt-2.5">
          {m.courseSettings_termLabel()}
          <span class="mt-0.5 block text-caption font-normal text-muted-foreground">
            {m.courseSettings_termLabelDesc()}
          </span>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="text-caption font-medium text-muted-foreground" for="academicYear">
              {m.coursesNew_academicYearLabel()}
            </label>
            <input
              id="academicYear"
              name="academicYear"
              type="number"
              min="100"
              max="999"
              placeholder={m.coursesNew_academicYearPlaceholder()}
              bind:value={$updateForm.academicYear}
              class="mt-1 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            {#if $errors.academicYear}
              <p class="mt-1 text-caption text-destructive">{$errors.academicYear}</p>
            {/if}
          </div>
          <div>
            <label class="text-caption font-medium text-muted-foreground" for="semester">
              {m.coursesNew_semesterLabel()}
            </label>
            <select
              id="semester"
              name="semester"
              bind:value={$updateForm.semester}
              class="mt-1 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value={undefined}>{m.coursesNew_semesterPlaceholder()}</option>
              <option value={1}>{m.coursesNew_semesterOption1()}</option>
              <option value={2}>{m.coursesNew_semesterOption2()}</option>
              <option value={3}>{m.coursesNew_semesterOption3()}</option>
            </select>
            {#if $errors.semester}
              <p class="mt-1 text-caption text-destructive">{$errors.semester}</p>
            {/if}
          </div>
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

  <!-- 2. Archive (reversible, separate from danger zone) -->
  <section
    class="animate-in animate-in-2 rounded-xl border border-border bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur-sm"
  >
    <div class="mb-6 flex items-start gap-3.5">
      <span
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
        aria-hidden="true"
      >
        {#if archivedLocal}
          <ArchiveRestore class="h-5 w-5" />
        {:else}
          <Archive class="h-5 w-5" />
        {/if}
      </span>
      <div>
        <h2 class="text-title-sm font-medium tracking-[-0.01em]">
          {archivedLocal
            ? m.courseSettings_archiveCardTitleArchived()
            : m.courseSettings_archiveCardTitleActive()}
        </h2>
        <p class="mt-1 text-caption text-muted-foreground">
          {m.courseSettings_archiveCardDesc()}
        </p>
      </div>
    </div>

    <form
      method="POST"
      action="?/toggleArchive"
      use:kitEnhance={() => {
        archiveSubmitting = true;
        // Optimistic flip — server response will reconcile via `update()`.
        archivedLocal = !archivedLocal;
        return async ({ result, update }) => {
          archiveSubmitting = false;
          if (result.type !== "success") {
            archivedLocal = !archivedLocal;
          }
          await applyAction(result);
          await update({ reset: false });
        };
      }}
    >
      <input type="hidden" name="archived" value={String(!archivedLocal)} />
      <Button type="submit" variant="outline" disabled={archiveSubmitting}>
        {#if archivedLocal}
          <ArchiveRestore class="h-4 w-4" aria-hidden="true" />
          {m.courseSettings_unarchiveButton()}
        {:else}
          <Archive class="h-4 w-4" aria-hidden="true" />
          {m.courseSettings_archiveButton()}
        {/if}
      </Button>
    </form>
  </section>

  <!-- 3. Danger zone -->
  <section
    class="animate-in animate-in-3 rounded-xl border p-5"
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
        <h2 class="text-title-sm font-medium tracking-[-0.01em] text-destructive">
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
        class="mb-4 flex items-start gap-3 rounded-md border border-destructive/40 border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 text-destructive"
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
      <Button variant="outline" onclick={() => (copyOpen = true)} disabled={copying}>
        <Copy class="h-4 w-4" aria-hidden="true" />
        {m.courseSettings_copyButton()}
      </Button>
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

<Dialog.Root open={copyOpen} onOpenChange={(v) => (copyOpen = v)}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{m.courseSettings_copyDialogTitle()}</Dialog.Title>
      <Dialog.Description>{m.courseSettings_copyDialogDesc()}</Dialog.Description>
    </Dialog.Header>

    {#if data.copyPreview}
      {@const a = data.copyPreview.assessments}
      {@const e = data.copyPreview.exams}
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
        class="space-y-5"
      >
        <div>
          <label for="copy-new-title" class="text-sm font-medium">
            {m.courseSettings_copyTitleLabel()}
          </label>
          <input
            id="copy-new-title"
            name="newTitle"
            type="text"
            required
            maxlength="120"
            class={inputClassName}
            bind:value={copyTitleInput}
          />
        </div>

        <div class="rounded-md border border-border bg-muted/30 px-4 py-3 text-caption">
          <div class="mb-2 font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.courseSettings_copyPreviewIncluded()}
          </div>
          <ul class="space-y-1.5 leading-relaxed">
            <li>
              {m.courseSettings_copyPreviewAssessments({
                total: a.total,
                draft: a.byStatus.draft,
                published: a.byStatus.published,
                archived: a.byStatus.archived
              })}
            </li>
            <li>
              {m.courseSettings_copyPreviewExams({
                total: e.total,
                draft: e.byStatus.draft,
                published: e.byStatus.published,
                archived: e.byStatus.archived
              })}
            </li>
            <li>
              {m.courseSettings_copyPreviewProblemLinks({
                count: a.problemLinks + e.problemLinks
              })}
            </li>
          </ul>
        </div>

        <div class="rounded-md border border-border bg-muted/30 px-4 py-3 text-caption">
          <div class="mb-2 font-mono text-micro uppercase tracking-wider text-muted-foreground">
            {m.courseSettings_copyPreviewExcluded()}
          </div>
          <p class="leading-relaxed text-muted-foreground">
            {m.courseSettings_copyPreviewExcludedDesc()}
          </p>
        </div>

        <Dialog.Footer class="flex justify-end gap-2">
          <Button type="button" variant="outline" onclick={() => (copyOpen = false)}>
            {m.courseSettings_copyCancel()}
          </Button>
          <Button type="submit" disabled={copying || copyTitleInput.trim().length === 0}>
            <Copy class="h-4 w-4" aria-hidden="true" />
            {m.courseSettings_copyConfirm()}
          </Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
