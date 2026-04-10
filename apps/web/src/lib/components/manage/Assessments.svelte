<script lang="ts">
  import {
    BookOpenCheck,
    Sparkles
  } from "@lucide/svelte";
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import {
    supportedLanguages,
    type AdjustmentRule,
    type Language
  } from "@nojv/core";
  import { inputClassName, toDateTimeLocalValue, toggleArrayItem } from "$lib/utils";
  import AdjustmentRulesEditor from "./AdjustmentRulesEditor.svelte";
  import SystemTextToggle, { type UiLang } from "./SystemTextToggle.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";

  import type { courseDomain } from "@nojv/domain";
  type CourseAssessmentRecord = courseDomain.CourseAssessmentRecord;

  type PlagiarismStatus = "idle" | "triggering" | "pending" | "running" | "completed" | "failed";

  // Homework assessment form: no scoreboard, no IP lock, no page lock —
  // those were exam-only concerns and now live on Contest. The only
  // assessment-specific controls still rendered are `maxAttempts` and
  // `adjustmentRules` (late-penalty rules), which remain on the DB row.
  interface Props {
    assessments: CourseAssessmentRecord[];
    courseSlug: string;
    form: SuperValidated<{
      allowedLanguages?: Language[] | undefined;
      closesAt: string;
      dueAt: string;
      maxAttempts?: number | null | undefined;
      opensAt: string;
      problemIdsText: string;
      slug: string;
      summary: string;
      title: string;
      adjustmentRules?: AdjustmentRule[] | undefined;
    }>;
    problemIds: string[];
  }

  let { assessments, courseSlug, form: formData, problemIds }: Props = $props();
  const initialProblemSlugs = untrack(() => problemIds);

  let uiLang = $state<UiLang>("zh");

  const text = {
    en: {
      all: "all",
      allowedLanguages: "Allowed languages (empty = all)",
      assessmentSummary: "Assessment summary",
      assessmentTitle: "Assessment title",
      assessments: "Assessments",
      createAssessment: "Create assessment",
      maxAttempts: "Max attempts (optional)",
      noLimit: "Unlimited",
      plagiarismCheck: "Run Plagiarism Check",
      plagiarismCompleted: "Completed",
      plagiarismFailed: "Failed",
      plagiarismPending: "Pending...",
      plagiarismRunning: "Running...",
      plagiarismStarting: "Starting...",
      problems: "problems",
      publishAssessment: "Publish assessment",
      publishing: "Publishing...",
      systemText: "System Text",
      viewResults: "View results"
    },
    zh: {
      all: "全部",
      allowedLanguages: "允許語言（留空代表全部）",
      assessmentSummary: "測驗摘要",
      assessmentTitle: "測驗標題",
      assessments: "測驗列表",
      createAssessment: "建立測驗",
      maxAttempts: "最大嘗試次數（可選）",
      noLimit: "不限制",
      plagiarismCheck: "執行抄襲檢查",
      plagiarismCompleted: "完成",
      plagiarismFailed: "失敗",
      plagiarismPending: "等待中...",
      plagiarismRunning: "執行中...",
      plagiarismStarting: "啟動中...",
      problems: "題",
      publishAssessment: "發布測驗",
      publishing: "發布中...",
      systemText: "系統文字",
      viewResults: "查看結果"
    }
  } as const;

  function t<K extends keyof (typeof text)["en"]>(key: K): string {
    return text[uiLang][key];
  }

  function createDefaultAssessmentWindow() {
    const opensAt = new Date();
    const dueAt = new Date(opensAt.getTime() + 1000 * 60 * 60 * 24 * 7);
    const closesAt = new Date(dueAt.getTime() + 1000 * 60 * 60 * 24);
    return {
      closesAt: toDateTimeLocalValue(closesAt),
      dueAt: toDateTimeLocalValue(dueAt),
      opensAt: toDateTimeLocalValue(opensAt)
    };
  }

  const textareaClassName = `${inputClassName} min-h-24 resize-y`;

  const defaultWindow = createDefaultAssessmentWindow();

  const { form, errors, submitting, message: formMessage, enhance } = superForm(untrack(() => formData), {
    dataType: "json",
    invalidateAll: true
  });

  // Set defaults for datetime fields
  if (!$form.opensAt) $form.opensAt = defaultWindow.opensAt;
  if (!$form.dueAt) $form.dueAt = defaultWindow.dueAt;
  if (!$form.closesAt) $form.closesAt = defaultWindow.closesAt;
  if (!$form.problemIdsText) $form.problemIdsText = initialProblemSlugs.join(", ");
  if (!$form.allowedLanguages) $form.allowedLanguages = [];

  // Adjustment rules — kept as a separate $state so AdjustmentRulesEditor
  // can bind to it, then synced into the form on every change.
  let adjustmentRules = $state<AdjustmentRule[]>($form.adjustmentRules ?? []);
  $effect(() => {
    $form.adjustmentRules = adjustmentRules;
  });

  function toggleLanguage(lang: Language) {
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }

  // Plagiarism check state per assessment
  let plagiarismStates: Record<string, PlagiarismStatus> = $state({});
  let activePollIntervals = new Map<string, ReturnType<typeof setInterval>>();

  function isCheckInProgress(assessmentId: string): boolean {
    const s = plagiarismStates[assessmentId];
    return s === "triggering" || s === "pending" || s === "running";
  }

  function clearPollInterval(assessmentId: string) {
    const id = activePollIntervals.get(assessmentId);
    if (id) {
      clearInterval(id);
      activePollIntervals.delete(assessmentId);
    }
  }

  function clearAllPolling() {
    for (const id of activePollIntervals.values()) clearInterval(id);
    activePollIntervals.clear();
  }

  $effect(() => {
    // Pause polling when tab is hidden, resume when visible
    function onVisibilityChange() {
      if (document.hidden) {
        clearAllPolling();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearAllPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  });

  async function triggerPlagiarismCheck(assessmentId: string) {
    clearPollInterval(assessmentId);
    plagiarismStates[assessmentId] = "triggering";

    try {
      const res = await fetch(`/api/plagiarism/${assessmentId}`, { method: "POST" });
      if (!res.ok) {
        plagiarismStates[assessmentId] = "failed";
        return;
      }
      plagiarismStates[assessmentId] = "pending";

      let pollCount = 0;
      const maxPolls = 200; // ~10 min at 3s intervals
      const pollInterval = setInterval(async () => {
        if (++pollCount > maxPolls) {
          clearPollInterval(assessmentId);
          plagiarismStates[assessmentId] = "failed";
          return;
        }
        try {
          const pollRes = await fetch(`/api/plagiarism/${assessmentId}`);
          if (!pollRes.ok) return;

          const { reports } = await pollRes.json();
          const latest = reports?.[0];
          if (!latest) return;

          plagiarismStates[assessmentId] = latest.status;
          if (latest.status === "completed" || latest.status === "failed") {
            clearPollInterval(assessmentId);
          }
        } catch (err) {
          console.warn(`Plagiarism poll failed for ${assessmentId}:`, err);
        }
      }, 3000);
      activePollIntervals.set(assessmentId, pollInterval);
    } catch {
      plagiarismStates[assessmentId] = "failed";
    }
  }

  function plagiarismLabel(status: PlagiarismStatus): string {
    switch (status) {
      case "triggering": return t("plagiarismStarting");
      case "pending": return t("plagiarismPending");
      case "running": return t("plagiarismRunning");
      case "completed": return t("plagiarismCompleted");
      case "failed": return t("plagiarismFailed");
      default: return t("plagiarismCheck");
    }
  }
</script>

<div class="space-y-6">
  <div class="flex justify-end">
    <SystemTextToggle bind:value={uiLang} label={t("systemText")} />
  </div>

  <section
    class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-6 py-6 shadow-rest backdrop-blur-sm"
  >
    <div class="flex items-center justify-between gap-4">
      <h3 class="inline-flex items-center gap-2 font-display text-title font-semibold"><BookOpenCheck class="h-5 w-5 text-muted-foreground" /> {t("assessments")}</h3>
      <Badge variant="muted" size="md" class="tabular-nums">
        {assessments.length}
      </Badge>
    </div>
    <div class="mt-5 grid gap-3">
      {#each assessments as assessment (assessment.slug)}
        <article
          class="rounded-sm border border-border-subtle bg-[color:var(--color-panel)] px-4 py-4"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="mt-2 text-body-lg font-semibold">{assessment.title}</p>
              <p class="mt-2 text-body-sm text-muted-foreground">
                {assessment.summary}
              </p>
            </div>
            <Badge variant="muted" size="md" class="tabular-nums">
              {assessment.problemIds.length} {t("problems")}
            </Badge>
          </div>
          {#if assessment.allowedLanguages.length > 0}
            <p class="mt-1 text-caption text-muted-foreground">
              {t("allowedLanguages")}: {assessment.allowedLanguages.join(", ")}
            </p>
          {/if}
          <div class="mt-3 flex items-center justify-between gap-4">
            <p class="text-body-sm text-muted-foreground tabular-nums">
              {assessment.opensAt.slice(0, 10)} &rarr; {assessment.closesAt.slice(0, 10)}
            </p>
            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                class="rounded-full"
                disabled={isCheckInProgress(assessment.id)}
                onclick={() => triggerPlagiarismCheck(assessment.id)}
              >
                {plagiarismLabel(plagiarismStates[assessment.id] ?? "idle")}
              </Button>
              {#if plagiarismStates[assessment.id] === "completed"}
                <Button
                  href="/courses/{courseSlug}/manage/plagiarism/{assessment.slug}"
                  size="sm"
                  class="rounded-full"
                >
                  {t("viewResults")}
                </Button>
              {/if}
            </div>
          </div>
        </article>
      {/each}
    </div>
  </section>

  <section
    class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-6 py-6 shadow-rest backdrop-blur-sm"
  >
    <h3 class="inline-flex items-center gap-2 font-display text-title font-semibold"><Sparkles class="h-5 w-5 text-muted-foreground" /> {t("createAssessment")}</h3>
    <form
      class="mt-4 grid gap-3"
      method="POST"
      action="?/create"
      use:enhance
    >
      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <input
            class={inputClassName}
            name="title"
            bind:value={$form.title}
            placeholder={t("assessmentTitle")}
            required
          />
          {#if $errors.title}<span class="text-body-sm text-destructive">{$errors.title}</span>{/if}
        </div>
        <div>
          <input
            class={inputClassName}
            name="slug"
            bind:value={$form.slug}
            pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
            placeholder="assessment-slug"
            required
          />
          {#if $errors.slug}<span class="text-body-sm text-destructive">{$errors.slug}</span>{/if}
        </div>
      </div>
      <div>
        <p class="mb-1 text-caption text-muted-foreground">{t("allowedLanguages")}</p>
        <div class="flex flex-wrap gap-3">
          {#each supportedLanguages as lang (lang)}
            <label class="inline-flex items-center gap-1.5 text-body-sm">
              <input
                type="checkbox"
                name="allowedLanguages"
                value={lang}
                checked={($form.allowedLanguages ?? []).includes(lang)}
                onchange={() => toggleLanguage(lang)}
              />
              {lang}
            </label>
          {/each}
        </div>
      </div>
      <div>
        <textarea
          class={textareaClassName}
          name="summary"
          bind:value={$form.summary}
          placeholder={t("assessmentSummary")}
          required
        ></textarea>
        {#if $errors.summary}<span class="text-body-sm text-destructive">{$errors.summary}</span>{/if}
      </div>
      <div>
        <textarea
          class={textareaClassName}
          name="problemIdsText"
          bind:value={$form.problemIdsText}
          placeholder="problem-one, problem-two"
          required
        ></textarea>
        {#if $errors.problemIdsText}<span class="text-body-sm text-destructive">{$errors.problemIdsText}</span>{/if}
      </div>
      <div class="grid gap-3 md:grid-cols-3">
        <div>
          <input class={inputClassName} name="opensAt" bind:value={$form.opensAt} required type="datetime-local" />
          {#if $errors.opensAt}<span class="text-body-sm text-destructive">{$errors.opensAt}</span>{/if}
        </div>
        <div>
          <input class={inputClassName} name="dueAt" bind:value={$form.dueAt} required type="datetime-local" />
          {#if $errors.dueAt}<span class="text-body-sm text-destructive">{$errors.dueAt}</span>{/if}
        </div>
        <div>
          <input class={inputClassName} name="closesAt" bind:value={$form.closesAt} required type="datetime-local" />
          {#if $errors.closesAt}<span class="text-body-sm text-destructive">{$errors.closesAt}</span>{/if}
        </div>
      </div>
      <div>
        <label class="text-caption text-muted-foreground" for="maxAttempts">{t("maxAttempts")}</label>
        <input
          class={inputClassName}
          id="maxAttempts"
          name="maxAttempts"
          type="number"
          min="1"
          max="999"
          placeholder={t("noLimit")}
          bind:value={$form.maxAttempts}
        />
      </div>
      <div class="mt-2 rounded-lg border border-border-subtle p-3">
        <AdjustmentRulesEditor bind:rules={adjustmentRules} />
      </div>
      <Button type="submit" loading={$submitting} disabled={$submitting} class="w-fit rounded-full px-5">
        {$submitting ? t("publishing") : t("publishAssessment")}
      </Button>
    </form>
    {#if $formMessage}
      <p class="mt-4 text-body-sm text-success">{$formMessage}</p>
    {/if}
  </section>
</div>
