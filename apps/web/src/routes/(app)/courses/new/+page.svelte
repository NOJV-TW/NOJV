<script lang="ts">
  import { untrack } from "svelte";
  import { ArrowRight, ChevronLeft, Info } from "@lucide/svelte";
  import { superForm } from "sveltekit-superforms/client";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import FormError from "$lib/components/primitives/ui/FormError.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import StepCard from "$lib/components/features/coursework/StepCard.svelte";
  import type { FormMessage } from "$lib/types/form-message";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const {
    form,
    errors,
    enhance,
    message: formMessage,
    submitting,
  } = superForm<typeof data.form.data, FormMessage>(
    untrack(() => data.form),
    { resetForm: false },
  );
</script>

<PageContainer width="form">
  <section class="animate-in mb-8">
    <a
      href="/courses"
      class="inline-flex items-center gap-1 text-body-sm text-muted-foreground transition-colors duration-fast ease-out-soft hover:text-foreground"
    >
      <ChevronLeft class="size-4" aria-hidden="true" />
      <span>{m.navigation_courses()}</span>
    </a>
    <h1 class="mt-3 text-display font-medium tracking-tight">
      {m.coursesNew_title()}
    </h1>
  </section>

  <form method="POST" use:enhance class="animate-in animate-in-1 space-y-6">
    <FormError message={$formMessage?.kind === "error" ? $formMessage.text : null} />

    <StepCard
      number={1}
      title={m.coursesNew_basicsTitle()}
      subtitle={m.coursesNew_basicsSubtitle()}
    >
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
            aria-invalid={Boolean($errors.title)}
            aria-describedby={$errors.title ? "title-error" : undefined}
            class="mt-2 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive"
          />
          {#if $errors.title}
            <p id="title-error" class="mt-1 text-caption text-destructive">{$errors.title}</p>
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
            aria-invalid={Boolean($errors.description)}
            aria-describedby={$errors.description ? "description-error" : undefined}
            class="mt-2 min-h-24 w-full resize-y rounded-md border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive"
          ></textarea>
          {#if $errors.description}
            <p id="description-error" class="mt-1 text-caption text-destructive">
              {$errors.description}
            </p>
          {/if}
        </div>
      </div>

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
              aria-invalid={Boolean($errors.academicYear)}
              aria-describedby={$errors.academicYear ? "academicYear-error" : undefined}
              class="mt-2 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive"
            />
            {#if $errors.academicYear}
              <p id="academicYear-error" class="mt-1 text-caption text-destructive">
                {$errors.academicYear}
              </p>
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
              aria-invalid={Boolean($errors.semester)}
              aria-describedby={$errors.semester ? "semester-error" : undefined}
              class="mt-2 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-body-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive"
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

      <div
        class="mt-5 flex items-start gap-3 rounded-md border border-info/20 bg-info/5 px-4 py-3.5 text-body-sm leading-snug text-muted-foreground"
      >
        <Info class="mt-0.5 size-5 shrink-0 text-info" aria-hidden="true" />
        <p>
          <strong class="font-semibold text-foreground"
            >{m.coursesNew_placeholderInfoLead()}</strong
          >
          {m.coursesNew_placeholderInfoBody()}
        </p>
      </div>
    </StepCard>

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
</PageContainer>
