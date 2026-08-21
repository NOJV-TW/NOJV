<script lang="ts">
  import { untrack } from "svelte";
  import { applyAction, enhance as kitEnhance } from "$app/forms";
  import { Copy, Info, Save, Settings, Trash2 } from "@lucide/svelte";
  import { superForm } from "sveltekit-superforms/client";
  import { m } from "$lib/paraglide/messages.js";
  import * as Dialog from "$lib/components/primitives/ui/dialog/index.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import FormError from "$lib/components/primitives/ui/FormError.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import { toasts } from "$lib/stores/toast";
  import { inputClassName } from "$lib/utils/css";
  import type { FormMessage } from "$lib/types/form-message";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const {
    form: updateForm,
    errors,
    enhance,
    message: updateMessage,
    submitting: updateSubmitting,
  } = superForm<typeof data.form.data, FormMessage>(
    untrack(() => data.form),
    { resetForm: false, taintedMessage: null },
  );

  let typedConfirmation = $state("");
  let deleting = $state(false);
  let deleteOpen = $state(false);
  let copying = $state(false);
  let copyOpen = $state(false);
  let copyTitleInput = $state(untrack(() => data.copyPreview?.suggestedTitle ?? ""));
  $effect(() => {
    if (copyOpen && data.copyPreview) {
      copyTitleInput = data.copyPreview.suggestedTitle;
    }
  });
  let archiveSubmitting = $state(false);
  let archivedLocal = $state(untrack(() => data.archived));
  $effect(() => {
    archivedLocal = data.archived;
  });

  const courseTitle = $derived(data.form.data.title);
  const canDelete = $derived(typedConfirmation === courseTitle && courseTitle.length > 0);

  const updateErrorText = $derived(
    $updateMessage?.kind === "error" ? $updateMessage.text : null,
  );
  const updateSuccess = $derived($updateMessage?.kind === "success");

  function resolveDangerBanner(actionResult: ActionData): string | null {
    if (actionResult == null || !("error" in actionResult)) return null;
    const errorCode = actionResult.error;
    if (typeof errorCode !== "string") return null;
    if (errorCode === "delete_mismatch") return m.courseSettings_deleteMismatchError();
    return errorCode;
  }

  const dangerBanner = $derived(resolveDangerBanner(form));
</script>

<PageContainer width="form" class="space-y-6">
  <section
    class="animate-in animate-in-1 rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-5 shadow-rest backdrop-blur-sm"
  >
    <div class="mb-6 flex items-start gap-3.5">
      <span
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
        aria-hidden="true"
      >
        <Settings aria-hidden="true" class="h-5 w-5" />
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
          class="mb-4 flex items-start gap-3 rounded-md border border-success/30 bg-success/10 px-4 py-3 text-success"
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
            aria-invalid={Boolean($errors.title)}
            aria-describedby={$errors.title ? "title-error" : undefined}
            class="w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive"
          />
          {#if $errors.title}
            <p id="title-error" class="mt-1 text-caption text-destructive">{$errors.title}</p>
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
            aria-invalid={Boolean($errors.description)}
            aria-describedby={$errors.description ? "description-error" : undefined}
            class="min-h-24 w-full resize-y rounded-md border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive"
          ></textarea>
          {#if $errors.description}
            <p id="description-error" class="mt-1 text-caption text-destructive">
              {$errors.description}
            </p>
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
              aria-invalid={Boolean($errors.academicYear)}
              aria-describedby={$errors.academicYear ? "academicYear-error" : undefined}
              class="mt-1 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive"
            />
            {#if $errors.academicYear}
              <p id="academicYear-error" class="mt-1 text-caption text-destructive">
                {$errors.academicYear}
              </p>
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
              aria-invalid={Boolean($errors.semester)}
              aria-describedby={$errors.semester ? "semester-error" : undefined}
              class="mt-1 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive"
            >
              <option value={undefined}>{m.coursesNew_semesterPlaceholder()}</option>
              <option value={1}>{m.coursesNew_semesterOption1()}</option>
              <option value={2}>{m.coursesNew_semesterOption2()}</option>
              <option value={3}>{m.coursesNew_semesterOption3()}</option>
            </select>
            {#if $errors.semester}
              <p id="semester-error" class="mt-1 text-caption text-destructive">
                {$errors.semester}
              </p>
            {/if}
          </div>
        </div>
      </div>

      <div class="flex items-center justify-end gap-3 pt-4">
        <Button type="submit" loading={$updateSubmitting} disabled={$updateSubmitting}>
          <Save class="h-4 w-4" aria-hidden="true" />
          {m.courseSettings_saveButton()}
        </Button>
      </div>
    </form>
  </section>

  <section
    class="animate-in animate-in-2 rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-5 shadow-rest"
  >
    {#if dangerBanner}
      <div
        role="alert"
        aria-live="polite"
        class="mb-4 flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive"
      >
        <p class="text-body-sm font-medium leading-snug">{dangerBanner}</p>
      </div>
    {/if}

    <div
      class="flex flex-col gap-4 border-b border-border-subtle pb-5 md:flex-row md:items-center md:justify-between"
    >
      <div>
        <h2 class="text-body-lg font-semibold tracking-[-0.005em]">
          {#if archivedLocal}
            {m.courseSettings_archiveCardTitleArchived()}
          {:else}
            {m.courseSettings_archiveCardTitleActive()}
          {/if}
        </h2>
        <p class="mt-1.5 max-w-2xl text-caption leading-relaxed text-muted-foreground">
          {m.courseSettings_archiveCardDesc()}
        </p>
      </div>
      <form
        method="POST"
        action="?/toggleArchive"
        use:kitEnhance={() => {
          archiveSubmitting = true;
          archivedLocal = !archivedLocal;
          return async ({ result, update }) => {
            archiveSubmitting = false;
            if (result.type !== "success") {
              archivedLocal = !archivedLocal;
            } else {
              toasts.success(
                archivedLocal
                  ? m.courseSettings_archiveSuccess()
                  : m.courseSettings_unarchiveSuccess(),
              );
            }
            await applyAction(result);
            await update({ reset: false });
          };
        }}
      >
        <input type="hidden" name="archived" value={String(!archivedLocal)} />
        <Button
          type="submit"
          variant="outline"
          loading={archiveSubmitting}
          disabled={archiveSubmitting}
        >
          {#if archivedLocal}
            {m.courseSettings_unarchiveButton()}
          {:else}
            {m.courseSettings_archiveButton()}
          {/if}
        </Button>
      </form>
    </div>

    <div class="mt-4 grid gap-3">
      <div
        class="flex flex-col gap-4 rounded-lg border border-border-subtle bg-background/30 p-4 md:flex-row md:items-center md:justify-between"
      >
        <div class="min-w-0">
          <h3 class="text-body-lg font-semibold tracking-[-0.005em]">
            {m.courseSettings_copyTitle()}
          </h3>
          <p class="mt-1.5 text-caption leading-relaxed text-muted-foreground">
            {m.courseSettings_copyDesc()}
          </p>
        </div>
        <Button
          class="shrink-0"
          variant="outline"
          onclick={() => (copyOpen = true)}
          disabled={copying}
        >
          <Copy class="h-4 w-4" aria-hidden="true" />
          {m.courseSettings_copyButton()}
        </Button>
      </div>

      <div
        class="flex flex-col gap-4 rounded-lg border border-border-subtle bg-background/30 p-4 md:flex-row md:items-center md:justify-between"
      >
        <div class="min-w-0">
          <h3 class="text-body-lg font-semibold tracking-[-0.005em]">
            {m.courseSettings_deleteTitle()}
          </h3>
          <p class="mt-1.5 text-caption leading-relaxed text-muted-foreground">
            {m.courseSettings_deleteDesc()}
          </p>
        </div>
        <Button class="shrink-0" variant="destructive" onclick={() => (deleteOpen = true)}>
          {m.courseSettings_deleteButton()}
        </Button>
      </div>
    </div>
  </section>
</PageContainer>

<Dialog.Root open={copyOpen} onOpenChange={(v) => (copyOpen = v)}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{m.courseSettings_copyDialogTitle()}</Dialog.Title>
      <Dialog.Description>{m.courseSettings_copyDialogDesc()}</Dialog.Description>
    </Dialog.Header>

    {#if data.copyPreview}
      {@const a = data.copyPreview.assignments}
      {@const e = data.copyPreview.exams}
      <form
        method="POST"
        action="?/copyCourse"
        use:kitEnhance={() => {
          copying = true;
          return async ({ result, update }) => {
            copying = false;
            if (result.type === "redirect") {
              toasts.success(m.courseSettings_copySuccess());
            }
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
                archived: a.byStatus.archived,
              })}
            </li>
            <li>
              {m.courseSettings_copyPreviewExams({
                total: e.total,
                draft: e.byStatus.draft,
                published: e.byStatus.published,
                archived: e.byStatus.archived,
              })}
            </li>
            <li>
              {m.courseSettings_copyPreviewProblemLinks({
                count: a.problemLinks + e.problemLinks,
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
          <Button
            type="submit"
            loading={copying}
            disabled={copying || copyTitleInput.trim().length === 0}
          >
            <Copy class="h-4 w-4" aria-hidden="true" />
            {m.courseSettings_copyConfirm()}
          </Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={deleteOpen}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{m.courseSettings_deleteTitle()}</Dialog.Title>
      <Dialog.Description>{m.courseSettings_deleteDesc()}</Dialog.Description>
    </Dialog.Header>
    <form
      method="POST"
      action="?/deleteCourse"
      use:kitEnhance={() => {
        deleting = true;
        return async ({ result, update }) => {
          deleting = false;
          if (result.type === "redirect") {
            toasts.success(m.courseSettings_deleteSuccess());
          }
          await applyAction(result);
          await update({ reset: false });
        };
      }}
      class="space-y-4"
    >
      <label for="typedConfirmation" class="text-caption font-medium text-muted-foreground">
        {m.courseSettings_deleteConfirmLabel({ title: courseTitle })}
      </label>
      <input
        id="typedConfirmation"
        name="typedConfirmation"
        type="text"
        bind:value={typedConfirmation}
        placeholder={courseTitle}
        class="w-full rounded-sm border border-border bg-transparent px-3 py-2 font-mono text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        autocomplete="off"
      />
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (deleteOpen = false)}>
          {m.courseSettings_copyCancel()}
        </Button>
        <Button
          type="submit"
          variant="destructive"
          loading={deleting}
          disabled={!canDelete || deleting}
        >
          {m.courseSettings_deleteButton()}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
