<script lang="ts">
  import { untrack } from "svelte";
  import { ArrowRight, ChevronLeft, Info } from "@lucide/svelte";
  import { superForm } from "sveltekit-superforms/client";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/ui/button";
  import FormError from "$lib/components/ui/FormError.svelte";
  import type { FormMessage } from "$lib/types/form-message";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const {
    form,
    errors,
    enhance,
    message: formMessage,
    submitting
  } = superForm<typeof data.form.data, FormMessage>(
    untrack(() => data.form),
    { resetForm: false }
  );
</script>

<div class="mx-auto w-full max-w-3xl px-6 pb-24">
  <!-- Page head -->
  <section class="animate-in mb-8">
    <a
      href="/courses"
      class="inline-flex items-center gap-1 text-body-sm text-muted-foreground transition-colors duration-fast ease-out-soft hover:text-foreground"
    >
      <ChevronLeft class="size-4" aria-hidden="true" />
      <span>{m.navigation_courses()}</span>
    </a>
    <h1 class="mt-3 font-display text-display font-medium tracking-tight">
      {m.coursesNew_title()}
    </h1>
    <p class="mt-2 max-w-2xl text-body-sm text-muted-foreground">
      {m.coursesNew_subtitle()}
    </p>
  </section>

  <form method="POST" use:enhance class="animate-in animate-in-1 space-y-6">
    <FormError message={$formMessage?.kind === "error" ? $formMessage.text : null} />

    <!-- Card 1 — Basics -->
    <div
      class="rounded-2xl border border-border bg-[color:var(--color-panel)] p-7 shadow-rest backdrop-blur-sm"
    >
      <div class="mb-6 flex items-center gap-3">
        <span
          class="flex h-7 w-7 items-center justify-center rounded-full bg-foreground font-display text-caption font-semibold text-background"
          aria-hidden="true"
        >
          1
        </span>
        <div>
          <h2 class="font-display text-title-sm font-medium tracking-[-0.01em]">
            {m.coursesNew_basicsTitle()}
          </h2>
          <p class="mt-0.5 text-caption text-muted-foreground">
            {m.coursesNew_basicsSubtitle()}
          </p>
        </div>
      </div>

      <div class="space-y-5">
        <div>
          <label class="text-body-sm font-medium" for="title">
            {m.coursesNew_titleLabel()}
            <span class="text-destructive">*</span>
          </label>
          <input
            id="title"
            name="title"
            type="text"
            placeholder={m.coursesNew_titlePlaceholder()}
            bind:value={$form.title}
            class="mt-2 w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
          {#if $errors.title}
            <p class="mt-1 text-caption text-destructive">{$errors.title}</p>
          {/if}
        </div>

        <div>
          <label class="text-body-sm font-medium" for="description">
            {m.coursesNew_descriptionLabel()}
          </label>
          <textarea
            id="description"
            name="description"
            rows="3"
            placeholder={m.coursesNew_descriptionPlaceholder()}
            bind:value={$form.description}
            class="mt-2 min-h-24 w-full resize-y rounded-lg border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          ></textarea>
          {#if $errors.description}
            <p class="mt-1 text-caption text-destructive">{$errors.description}</p>
          {/if}
        </div>
      </div>

      <!-- Term (optional) -->
      <div class="mt-5 space-y-5 border-t border-border-subtle pt-5">
        <p class="text-body-sm font-medium">{m.coursesNew_termTitle()}</p>
        <p class="-mt-4 text-caption text-muted-foreground">{m.coursesNew_termSubtitle()}</p>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="text-body-sm font-medium" for="academicYear">
              {m.coursesNew_academicYearLabel()}
            </label>
            <input
              id="academicYear"
              name="academicYear"
              type="number"
              min="100"
              max="999"
              placeholder={m.coursesNew_academicYearPlaceholder()}
              bind:value={$form.academicYear}
              class="mt-2 w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            {#if $errors.academicYear}
              <p class="mt-1 text-caption text-destructive">{$errors.academicYear}</p>
            {/if}
          </div>
          <div>
            <label class="text-body-sm font-medium" for="semester">
              {m.coursesNew_semesterLabel()}
            </label>
            <select
              id="semester"
              name="semester"
              bind:value={$form.semester}
              class="mt-2 w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
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

      <!-- Placeholder user info banner -->
      <div
        class="mt-5 flex items-start gap-3 rounded-md border border-info/20 border-l-4 border-l-info bg-info/5 px-4 py-3.5 text-body-sm leading-snug text-muted-foreground"
      >
        <Info class="mt-0.5 size-5 shrink-0 text-info" aria-hidden="true" />
        <p>
          <strong class="font-semibold text-foreground"
            >{m.coursesNew_placeholderInfoLead()}</strong
          >
          {m.coursesNew_placeholderInfoBody()}
        </p>
      </div>
    </div>

    <!-- Form actions -->
    <div
      class="flex flex-wrap items-center justify-end gap-3 border-t border-border-subtle pt-6"
    >
      <span class="mr-auto text-caption text-muted-foreground">
        {m.coursesNew_actionsHint()}
      </span>
      <Button href="/courses" variant="ghost">{m.common_cancel()}</Button>
      <Button type="submit" disabled={$submitting}>
        {m.coursesNew_submit()}
        <ArrowRight class="size-4" aria-hidden="true" />
      </Button>
    </div>
  </form>
</div>
