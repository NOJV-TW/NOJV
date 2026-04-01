<script lang="ts">
  import { browser } from "$app/environment";
  import {
    BookOpenCheck,
    CalendarRange,
    Languages,
    Shield,
    Sparkles
  } from "@lucide/svelte";
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import { onMount } from "svelte";
  import { supportedLanguages, type AssessmentScoreboardMode, type Language } from "@nojv/core";
  import { inputClassName, toDateTimeLocalValue, toggleArrayItem } from "$lib/utils";

  import type { CourseAssessmentRecord } from "$lib/server/course/queries";

  type PlagiarismStatus = "idle" | "triggering" | "pending" | "running" | "completed" | "failed";

  interface Props {
    assessments: CourseAssessmentRecord[];
    courseSlug: string;
    form: SuperValidated<{
      allowedLanguages?: Language[] | undefined;
      closesAt: string;
      dueAt: string;
      ipBindingEnabled: boolean;
      ipViolationMode: string;
      ipWhitelistEnabled: boolean;
      ipWhitelistText: string;
      maxAttempts?: number | null | undefined;
      opensAt: string;
      pageLockEnabled: boolean;
      problemSlugsText: string;
      scoreboardMode?: AssessmentScoreboardMode | undefined;
      slug: string;
      summary: string;
      title: string;
    }>;
    problemSlugs: string[];
  }

  let { assessments, courseSlug, form: formData, problemSlugs }: Props = $props();
  const initialProblemSlugs = untrack(() => problemSlugs);

  type UiLang = "zh" | "en";
  let uiLang = $state<UiLang>("zh");

  const text = {
    en: {
      all: "all",
      allowedLanguages: "Allowed languages (empty = all)",
      assessmentSummary: "Assessment summary",
      assessmentTitle: "Assessment title",
      assessments: "Assessments",
      block: "Block",
      createAssessment: "Create assessment",
      english: "English",
      maxAttempts: "Max attempts (optional)",
      noLimit: "Unlimited",
      notifyOnly: "Notify only",
      pageLock: "Page lock (prevent tab switching)",
      plagiarismCheck: "Run Plagiarism Check",
      plagiarismCompleted: "Completed",
      plagiarismFailed: "Failed",
      plagiarismPending: "Pending...",
      plagiarismRunning: "Running...",
      plagiarismStarting: "Starting...",
      problems: "problems",
      publishAssessment: "Publish assessment",
      publishing: "Publishing...",
      scoreboardMode: "Scoreboard mode",
      systemText: "System Text",
      viewResults: "View results",
      whenIpViolation: "When IP violation occurs:",
      whitelist: "IP Whitelist",
      ipBinding: "IP First-Binding (lock to first IP used)",
      zh: "中文"
    },
    zh: {
      all: "全部",
      allowedLanguages: "允許語言（留空代表全部）",
      assessmentSummary: "測驗摘要",
      assessmentTitle: "測驗標題",
      assessments: "測驗列表",
      block: "封鎖",
      createAssessment: "建立測驗",
      english: "English",
      maxAttempts: "最大嘗試次數（可選）",
      noLimit: "不限制",
      notifyOnly: "僅通知",
      pageLock: "分頁鎖定（避免切換分頁）",
      plagiarismCheck: "執行抄襲檢查",
      plagiarismCompleted: "完成",
      plagiarismFailed: "失敗",
      plagiarismPending: "等待中...",
      plagiarismRunning: "執行中...",
      plagiarismStarting: "啟動中...",
      problems: "題",
      publishAssessment: "發布測驗",
      publishing: "發布中...",
      scoreboardMode: "記分板模式",
      systemText: "系統文字",
      viewResults: "查看結果",
      whenIpViolation: "發生 IP 違規時：",
      whitelist: "IP 白名單",
      ipBinding: "IP 首次綁定（鎖定首次使用 IP）",
      zh: "中文"
    }
  } as const;

  function t<K extends keyof (typeof text)["en"]>(key: K): string {
    return text[uiLang][key];
  }

  onMount(() => {
    if (!browser) return;
    const saved = localStorage.getItem("nojv-system-text-lang");
    if (saved === "zh" || saved === "en") {
      uiLang = saved;
    }
  });

  function setUiLang(next: UiLang): void {
    uiLang = next;
    if (browser) {
      localStorage.setItem("nojv-system-text-lang", next);
    }
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
    invalidateAll: true
  });

  // Set defaults for datetime fields
  if (!$form.opensAt) $form.opensAt = defaultWindow.opensAt;
  if (!$form.dueAt) $form.dueAt = defaultWindow.dueAt;
  if (!$form.closesAt) $form.closesAt = defaultWindow.closesAt;
  if (!$form.problemSlugsText) $form.problemSlugsText = initialProblemSlugs.join(", ");
  if (!$form.allowedLanguages) $form.allowedLanguages = [];

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
    <div class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 p-1">
      <span class="inline-flex items-center gap-1 px-2 text-xs text-muted-foreground">
        <Languages class="h-3.5 w-3.5" /> {t("systemText")}
      </span>
      <button
        type="button"
        class="rounded-full px-3 py-1 text-xs font-medium {uiLang === 'zh' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}"
        onclick={() => setUiLang("zh")}
      >
        {t("zh")}
      </button>
      <button
        type="button"
        class="rounded-full px-3 py-1 text-xs font-medium {uiLang === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}"
        onclick={() => setUiLang("en")}
      >
        {t("english")}
      </button>
    </div>
  </div>

  <section
    class="rounded-4xl border border-border bg-(--color-panel) px-5 py-5 backdrop-blur-sm"
  >
    <div class="flex items-center justify-between gap-4">
      <h3 class="inline-flex items-center gap-2 text-2xl font-semibold"><BookOpenCheck class="h-5 w-5 text-muted-foreground" /> {t("assessments")}</h3>
      <span
        class="rounded-full border border-border px-3 py-1 text-xs font-medium"
      >
        {assessments.length}
      </span>
    </div>
    <div class="mt-5 grid gap-3">
      {#each assessments as assessment (assessment.slug)}
        <article
          class="rounded-3xl border border-border bg-(--color-panel) px-4 py-4"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="mt-2 text-lg font-semibold">{assessment.title}</p>
              <p class="mt-2 text-sm text-muted-foreground">
                {assessment.summary}
              </p>
            </div>
            <span
              class="rounded-full border border-border px-3 py-1 text-xs font-medium"
            >
              {assessment.problemSlugs.length} {t("problems")}
            </span>
          </div>
          {#if assessment.allowedLanguages.length > 0}
            <p class="mt-1 text-xs text-muted-foreground">
              {t("allowedLanguages")}: {assessment.allowedLanguages.join(", ")}
            </p>
          {/if}
          <div class="mt-3 flex items-center justify-between gap-4">
            <p class="text-sm text-muted-foreground">
              {assessment.opensAt.slice(0, 10)} &rarr; {assessment.closesAt.slice(0, 10)}
            </p>
            <div class="flex items-center gap-2">
              <button
                class="rounded-full border border-border px-3 py-1 text-xs font-medium transition hover:-translate-y-0.5 hover:bg-(--color-panel) disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isCheckInProgress(assessment.id)}
                onclick={() => triggerPlagiarismCheck(assessment.id)}
              >
                {plagiarismLabel(plagiarismStates[assessment.id] ?? "idle")}
              </button>
              {#if plagiarismStates[assessment.id] === "completed"}
                <a
                  href="/courses/{courseSlug}/manage/plagiarism/{assessment.slug}"
                  class="rounded-full bg-primary px-3 py-1 text-xs font-medium text-white transition hover:-translate-y-0.5"
                >
                  {t("viewResults")}
                </a>
              {/if}
            </div>
          </div>
        </article>
      {/each}
    </div>
  </section>

  <section
    class="rounded-4xl border border-border bg-(--color-panel) px-5 py-5 backdrop-blur-sm"
  >
    <h3 class="inline-flex items-center gap-2 text-2xl font-semibold"><Sparkles class="h-5 w-5 text-muted-foreground" /> {t("createAssessment")}</h3>
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
          {#if $errors.title}<span class="text-sm text-red-700 dark:text-red-400">{$errors.title}</span>{/if}
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
          {#if $errors.slug}<span class="text-sm text-red-700 dark:text-red-400">{$errors.slug}</span>{/if}
        </div>
      </div>
      <div>
        <label class="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground" for="scoreboardMode"><CalendarRange class="h-3.5 w-3.5" /> {t("scoreboardMode")}</label>
        <select class={inputClassName} name="scoreboardMode" bind:value={$form.scoreboardMode}>
          <option value="hidden">hidden</option>
          <option value="live">live</option>
          <option value="frozen">frozen</option>
        </select>
      </div>
      <div>
        <p class="mb-1 text-xs text-muted-foreground">{t("allowedLanguages")}</p>
        <div class="flex flex-wrap gap-3">
          {#each supportedLanguages as lang (lang)}
            <label class="inline-flex items-center gap-1.5 text-sm">
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
        {#if $errors.summary}<span class="text-sm text-red-700 dark:text-red-400">{$errors.summary}</span>{/if}
      </div>
      <div>
        <textarea
          class={textareaClassName}
          name="problemSlugsText"
          bind:value={$form.problemSlugsText}
          placeholder="problem-one, problem-two"
          required
        ></textarea>
        {#if $errors.problemSlugsText}<span class="text-sm text-red-700 dark:text-red-400">{$errors.problemSlugsText}</span>{/if}
      </div>
      <div class="grid gap-3 md:grid-cols-3">
        <div>
          <input class={inputClassName} name="opensAt" bind:value={$form.opensAt} required type="datetime-local" />
          {#if $errors.opensAt}<span class="text-sm text-red-700 dark:text-red-400">{$errors.opensAt}</span>{/if}
        </div>
        <div>
          <input class={inputClassName} name="dueAt" bind:value={$form.dueAt} required type="datetime-local" />
          {#if $errors.dueAt}<span class="text-sm text-red-700 dark:text-red-400">{$errors.dueAt}</span>{/if}
        </div>
        <div>
          <input class={inputClassName} name="closesAt" bind:value={$form.closesAt} required type="datetime-local" />
          {#if $errors.closesAt}<span class="text-sm text-red-700 dark:text-red-400">{$errors.closesAt}</span>{/if}
        </div>
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" name="pageLockEnabled" bind:checked={$form.pageLockEnabled} />
          {t("pageLock")}
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" name="ipWhitelistEnabled" bind:checked={$form.ipWhitelistEnabled} />
          {t("whitelist")}
        </label>
      </div>
      {#if $form.ipWhitelistEnabled}
        <div>
          <textarea
            class={textareaClassName}
            name="ipWhitelistText"
            bind:value={$form.ipWhitelistText}
            placeholder="CIDR ranges, one per line&#10;e.g. 140.112.0.0/16"
            rows="3"
          ></textarea>
        </div>
      {/if}
      <div class="grid gap-3 md:grid-cols-2">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" name="ipBindingEnabled" bind:checked={$form.ipBindingEnabled} />
          {t("ipBinding")}
        </label>
      </div>
      {#if $form.ipWhitelistEnabled || $form.ipBindingEnabled}
        <div class="flex items-center gap-4 text-sm">
          <span class="inline-flex items-center gap-1 text-muted-foreground"><Shield class="h-3.5 w-3.5" /> {t("whenIpViolation")}</span>
          <label class="flex items-center gap-1.5">
            <input type="radio" name="ipViolationMode" value="block" bind:group={$form.ipViolationMode} />
            {t("block")}
          </label>
          <label class="flex items-center gap-1.5">
            <input type="radio" name="ipViolationMode" value="notify" bind:group={$form.ipViolationMode} />
            {t("notifyOnly")}
          </label>
        </div>
      {/if}
      <div>
        <label class="text-xs text-muted-foreground" for="maxAttempts">{t("maxAttempts")}</label>
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
      <button
        class="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={$submitting}
        type="submit"
      >
        {$submitting ? t("publishing") : t("publishAssessment")}
      </button>
    </form>
    {#if $formMessage}
      <p class="mt-4 text-sm text-emerald-700 dark:text-emerald-400">{$formMessage}</p>
    {/if}
  </section>
</div>
