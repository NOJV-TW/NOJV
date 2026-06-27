<script lang="ts">
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { superForm } from "sveltekit-superforms/client";
  import { supportedLanguages, type Language } from "@nojv/core";
  import { inputClassName } from "$lib/utils/css";
  import { toggleArrayItem } from "$lib/utils";
  import { m } from "$lib/paraglide/messages.js";
  import TrophyIcon from "@lucide/svelte/icons/trophy";
  import ClockIcon from "@lucide/svelte/icons/clock";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import CodeIcon from "@lucide/svelte/icons/code";
  import ListIcon from "@lucide/svelte/icons/list";
  import { Card } from "$lib/components/primitives/ui/card/index.js";
  import { Button } from "$lib/components/primitives/ui/button/index.js";
  import FormError from "$lib/components/primitives/ui/FormError.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHero from "$lib/components/primitives/layout/PageHero.svelte";
  import ExamProblemPicker from "$lib/components/features/course/exam/ExamProblemPicker.svelte";
  import { toasts } from "$lib/stores/toast";
  import type { FormMessage } from "$lib/types/form-message";

  let { data } = $props();

  const {
    form,
    errors,
    enhance,
    submitting,
    message: formMessage,
  } = superForm<typeof data.form.data, FormMessage>(
    untrack(() => data.form),
    {
      dataType: "json",
      resetForm: false,
      onUpdated({ form }) {
        if (form.message?.kind === "success") {
          toasts.success(m.contestCreate_success());
          goto("/contests");
        }
      },
    },
  );

  function toggleLanguage(lang: Language) {
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }
</script>

<PageContainer width="form" class="space-y-6">
  <PageHero
    variant="workspace"
    breadcrumbHref="/contests"
    breadcrumbLabel={m.contestCreate_breadcrumb()}
    eyebrow={m.contestCreate_eyebrow()}
    title={m.contestCreate_title()}
  />

  <Card variant="surface" size="hero" class="max-w-2xl">
    <form method="POST" action="?/create" use:enhance class="space-y-5">
      <FormError message={$formMessage?.kind === "error" ? m.contestCreate_error() : null} />
      <div>
        <label class="text-sm font-medium" for="id">{m.contestCreate_slug()}</label>
        <input
          class={inputClassName}
          id="id"
          name="id"
          type="text"
          placeholder={m.contestCreate_slugPlaceholder()}
          bind:value={$form.id}
          aria-invalid={Boolean($errors.id)}
          aria-describedby={$errors.id ? "id-error" : undefined}
        />
        {#if $errors.id}<p id="id-error" class="mt-1 text-xs text-destructive">
            {$errors.id}
          </p>{/if}
      </div>

      <div>
        <label class="text-sm font-medium" for="title">{m.contestCreate_titleField()}</label>
        <input
          class={inputClassName}
          id="title"
          name="title"
          type="text"
          placeholder={m.contestCreate_titlePlaceholder()}
          bind:value={$form.title}
          aria-invalid={Boolean($errors.title)}
          aria-describedby={$errors.title ? "title-error" : undefined}
        />
        {#if $errors.title}<p id="title-error" class="mt-1 text-xs text-destructive">
            {$errors.title}
          </p>{/if}
      </div>

      <div>
        <label class="text-sm font-medium" for="summary">{m.contestCreate_summary()}</label>
        <textarea
          class="{inputClassName} min-h-24 resize-y"
          id="summary"
          name="summary"
          placeholder={m.contestCreate_summaryPlaceholder()}
          bind:value={$form.summary}
          aria-invalid={Boolean($errors.summary)}
          aria-describedby={$errors.summary ? "summary-error" : undefined}
        ></textarea>
        {#if $errors.summary}<p id="summary-error" class="mt-1 text-xs text-destructive">
            {$errors.summary}
          </p>{/if}
      </div>

      <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <ClockIcon aria-hidden="true" class="h-4 w-4" />
        <span>{m.common_timeline()}</span>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="text-sm font-medium" for="startsAt">{m.contestCreate_startsAt()}</label>
          <input
            class={inputClassName}
            id="startsAt"
            name="startsAt"
            type="datetime-local"
            bind:value={$form.startsAt}
            aria-invalid={Boolean($errors.startsAt)}
            aria-describedby={$errors.startsAt ? "startsAt-error" : undefined}
          />
          {#if $errors.startsAt}<p id="startsAt-error" class="mt-1 text-xs text-destructive">
              {$errors.startsAt}
            </p>{/if}
        </div>
        <div>
          <label class="text-sm font-medium" for="endsAt">{m.contestCreate_endsAt()}</label>
          <input
            class={inputClassName}
            id="endsAt"
            name="endsAt"
            type="datetime-local"
            bind:value={$form.endsAt}
            aria-invalid={Boolean($errors.endsAt)}
            aria-describedby={$errors.endsAt ? "endsAt-error" : undefined}
          />
          {#if $errors.endsAt}<p id="endsAt-error" class="mt-1 text-xs text-destructive">
              {$errors.endsAt}
            </p>{/if}
        </div>
      </div>

      <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <SettingsIcon aria-hidden="true" class="h-4 w-4" />
        <span>{m.contestCreate_scoringMode()}</span>
      </div>
      <div>
        <label class="text-sm font-medium" for="scoringMode"
          >{m.contestCreate_scoringMode()}</label
        >
        <select
          class={inputClassName}
          id="scoringMode"
          name="scoringMode"
          bind:value={$form.scoringMode}
        >
          <option value="problem_count">{m.contestCreate_scoringModeProblemCount()}</option>
          <option value="point_sum">{m.contestCreate_scoringModePointSum()}</option>
        </select>
      </div>

      <div>
        <label class="text-sm font-medium" for="submitCooldownSec"
          >{m.contestCreate_submitCooldown()}</label
        >
        <input
          class={inputClassName}
          id="submitCooldownSec"
          name="submitCooldownSec"
          type="number"
          min="0"
          max="3600"
          bind:value={$form.submitCooldownSec}
          aria-invalid={Boolean($errors.submitCooldownSec)}
          aria-describedby={$errors.submitCooldownSec ? "submitCooldownSec-error" : undefined}
        />
        {#if $errors.submitCooldownSec}<p
            id="submitCooldownSec-error"
            class="mt-1 text-xs text-destructive"
          >
            {$errors.submitCooldownSec}
          </p>{/if}
      </div>

      <div>
        <label class="text-sm font-medium" for="penaltyMinutesPerWrong"
          >{m.contestCreate_penaltyMinutes()}</label
        >
        <input
          class={inputClassName}
          id="penaltyMinutesPerWrong"
          name="penaltyMinutesPerWrong"
          type="number"
          min="0"
          max="1440"
          bind:value={$form.penaltyMinutesPerWrong}
          aria-invalid={Boolean($errors.penaltyMinutesPerWrong)}
          aria-describedby={$errors.penaltyMinutesPerWrong
            ? "penaltyMinutesPerWrong-error"
            : undefined}
        />
        {#if $errors.penaltyMinutesPerWrong}<p
            id="penaltyMinutesPerWrong-error"
            class="mt-1 text-xs text-destructive"
          >
            {$errors.penaltyMinutesPerWrong}
          </p>{/if}
      </div>

      <div>
        <label class="text-sm font-medium" for="scoreboardMode"
          >{m.contestCreate_scoreboardMode()}</label
        >
        <select
          class={inputClassName}
          id="scoreboardMode"
          name="scoreboardMode"
          bind:value={$form.scoreboardMode}
        >
          <option value="live">{m.contestDetail_live()}</option>
          <option value="frozen">{m.contestDetail_frozen()}</option>
          <option value="hidden">{m.contestCreate_scoreboardModeHidden()}</option>
        </select>
      </div>

      <div>
        <label class="text-sm font-medium" for="frozenAt">{m.contestCreate_freezeAt()}</label>
        <input
          class={inputClassName}
          id="frozenAt"
          name="frozenAt"
          type="datetime-local"
          bind:value={$form.frozenAt}
        />
      </div>

      <div>
        <label class="text-sm font-medium" for="inviteCode"
          >{m.contestCreate_inviteCode()}</label
        >
        <input
          class={inputClassName}
          id="inviteCode"
          name="inviteCode"
          type="text"
          placeholder={m.contestCreate_inviteCodePlaceholder()}
          bind:value={$form.inviteCode}
          aria-invalid={Boolean($errors.inviteCode)}
          aria-describedby={$errors.inviteCode ? "inviteCode-error" : undefined}
        />
        {#if $errors.inviteCode}<p id="inviteCode-error" class="mt-1 text-xs text-destructive">
            {$errors.inviteCode}
          </p>{/if}
        <p class="mt-1 text-xs text-muted-foreground">
          {m.contestCreate_inviteCodeHint()}
        </p>
      </div>

      <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <CodeIcon aria-hidden="true" class="h-4 w-4" />
        <span>{m.contestCreate_allowedLanguages()}</span>
      </div>
      <div>
        <p class="text-xs text-muted-foreground">{m.contestCreate_allowedLanguagesHint()}</p>
        <div
          class="mt-3 flex flex-wrap gap-2"
          role="group"
          aria-label={m.contestCreate_allowedLanguages()}
          aria-describedby={$errors.allowedLanguages ? "allowedLanguages-error" : undefined}
        >
          {#each supportedLanguages as lang (lang)}
            {@const checked = ($form.allowedLanguages ?? []).includes(lang)}
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-body-sm font-medium transition-colors {checked
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-[color:var(--color-panel)] text-foreground hover:border-border-strong'}"
              onclick={() => toggleLanguage(lang)}
              aria-pressed={checked}
            >
              {lang}
            </button>
          {/each}
        </div>
        {#if $errors.allowedLanguages}<p
            id="allowedLanguages-error"
            class="mt-1 text-xs text-destructive"
          >
            {$errors.allowedLanguages}
          </p>{/if}
      </div>

      <div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <ListIcon aria-hidden="true" class="h-4 w-4" />
        <span>{m.contestCreate_problemIds()}</span>
      </div>
      <ExamProblemPicker
        candidateProblems={data.candidateProblems}
        bind:problemIds={$form.problemIds}
        error={$errors.problemIds}
      />

      <Button type="submit" size="lg" loading={$submitting}>
        <TrophyIcon aria-hidden="true" class="h-4 w-4" />
        {m.contestCreate_button()}
      </Button>
    </form>
  </Card>
</PageContainer>
