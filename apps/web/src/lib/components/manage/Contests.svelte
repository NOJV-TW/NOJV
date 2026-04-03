<script lang="ts">
  import { browser } from "$app/environment";
  import { CalendarRange, Languages, Shield, Sparkles, Trophy } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import { supportedLanguages, type AssessmentScoreboardMode, type ContestScoringMode } from "@nojv/core";
  import { inputClassName, toDateTimeLocalValue, toggleArrayItem } from "$lib/utils";
  import type { contestDomain } from "@nojv/domain";
  type ContestListItem = contestDomain.ContestListItem;
  import EmptyState from "$lib/components/ui/EmptyState.svelte";

  interface Props {
    contests: ContestListItem[];
    courseSlug: string;
    form: SuperValidated<{
      allowedLanguages: string[];
      endsAt: string;
      frozenAt?: string | undefined;
      ipBindingEnabled: boolean;
      ipViolationMode: string;
      ipWhitelistEnabled: boolean;
      ipWhitelistText: string;
      maxAttempts?: number | null | undefined;
      pageLockEnabled: boolean;
      problemSlugsText: string;
      scoreboardMode: AssessmentScoreboardMode;
      scoringMode: ContestScoringMode;
      slug: string;
      startsAt: string;
      submitCooldownSec: number;
      summary: string;
      title: string;
    }>;
    problemSlugs: string[];
  }

  let { contests, courseSlug, form: formData, problemSlugs }: Props = $props();
  const initialProblemSlugs = untrack(() => problemSlugs);

  type UiLang = "zh" | "en";
  let uiLang = $state<UiLang>("zh");

  const text = {
    en: {
      allLanguages: "all languages",
      allowedLanguages: "Allowed languages (leave empty for all)",
      block: "Block",
      contestSummary: "Contest summary",
      contestTitle: "Contest title",
      contests: "Contests",
      cooldown: "Cooldown (sec)",
      createContest: "Create Contest",
      creating: "Creating...",
      endsAt: "Ends at",
      english: "English",
      freezeAt: "Freeze at (optional)",
      maxAttempts: "Max attempts (optional)",
      noContestDesc: "Create your first contest below.",
      noContestTitle: "No contests yet",
      notifyOnly: "Notify only",
      pageLock: "Page lock (prevent tab switching)",
      participants: "participants",
      problems: "problems",
      scoreboardMode: "Scoreboard mode",
      startsAt: "Starts at",
      systemText: "System Text",
      unlimited: "Unlimited",
      whenIpViolation: "When IP violation occurs:",
      whitelist: "IP Whitelist",
      ipBinding: "IP First-Binding (lock to first IP used)",
      zh: "中文"
    },
    zh: {
      allLanguages: "全部語言",
      allowedLanguages: "允許語言（留空代表全部）",
      block: "封鎖",
      contestSummary: "競賽摘要",
      contestTitle: "競賽標題",
      contests: "競賽列表",
      cooldown: "冷卻時間（秒）",
      createContest: "建立競賽",
      creating: "建立中...",
      endsAt: "結束時間",
      english: "English",
      freezeAt: "凍結時間（可選）",
      maxAttempts: "最大嘗試次數（可選）",
      noContestDesc: "在下方建立第一個競賽。",
      noContestTitle: "尚未建立競賽",
      notifyOnly: "僅通知",
      pageLock: "分頁鎖定（避免切換分頁）",
      participants: "參與者",
      problems: "題",
      scoreboardMode: "記分板模式",
      startsAt: "開始時間",
      systemText: "系統文字",
      unlimited: "不限制",
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

  function toggleLanguage(lang: string) {
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }

  const textareaClassName = `${inputClassName} min-h-24 resize-y`;

  const defaultStart = toDateTimeLocalValue(new Date());
  const defaultEnd = toDateTimeLocalValue(
    new Date(Date.now() + 1000 * 60 * 60 * 3)
  );

  const { form, errors, submitting, message: formMessage, enhance } = superForm(
    untrack(() => formData),
    { invalidateAll: true }
  );

  if (!$form.startsAt) $form.startsAt = defaultStart;
  if (!$form.endsAt) $form.endsAt = defaultEnd;
  if (!$form.problemSlugsText) $form.problemSlugsText = initialProblemSlugs.join(", ");
  if (!$form.scoringMode) $form.scoringMode = "icpc";
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

  <!-- Existing contests -->
  <section
    class="rounded-4xl border border-border bg-(--color-panel) px-5 py-5 backdrop-blur-sm"
  >
    <div class="flex items-center justify-between gap-4">
      <h3 class="inline-flex items-center gap-2 text-2xl font-semibold"><Trophy class="h-5 w-5 text-muted-foreground" /> {t("contests")}</h3>
      <span class="rounded-full border border-border px-3 py-1 text-xs font-medium">
        {contests.length}
      </span>
    </div>
    <div class="mt-5 grid gap-3">
      {#each contests as contest (contest.slug)}
        <article
          class="rounded-3xl border border-border bg-(--color-panel) px-4 py-4"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm uppercase tracking-[0.18em] text-muted-foreground">
                {contest.scoringMode}
              </p>
              <a href="/contests/{contest.slug}" class="mt-2 text-lg font-semibold hover:underline">
                {contest.title}
              </a>
            </div>
            <span class="rounded-full border border-border px-3 py-1 text-xs font-medium">
              {contest.problemCount} {t("problems")}
            </span>
          </div>
          <p class="mt-2 text-sm text-muted-foreground">
            {contest.startsAt.slice(0, 10)} &rarr; {contest.endsAt.slice(0, 10)}
            &middot; {contest.participantCount} {t("participants")}
          </p>
          <div class="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {#if contest.pageLockEnabled}<span class="rounded-full border border-border px-2 py-0.5">page-lock</span>{/if}
            {#if contest.ipWhitelistEnabled}<span class="rounded-full border border-border px-2 py-0.5">ip-whitelist</span>{/if}
            {#if contest.ipBindingEnabled}<span class="rounded-full border border-border px-2 py-0.5">ip-binding</span>{/if}
            {#if contest.maxAttempts != null}<span class="rounded-full border border-border px-2 py-0.5">max {contest.maxAttempts} attempts</span>{/if}
            <span class="rounded-full border border-border px-2 py-0.5">{contest.scoreboardMode} scoreboard</span>
            {#if contest.allowedLanguages.length > 0}
              <span class="rounded-full border border-border px-2 py-0.5">{contest.allowedLanguages.join(", ")}</span>
            {:else}
              <span class="rounded-full border border-border px-2 py-0.5">{t("allLanguages")}</span>
            {/if}
          </div>
        </article>
      {:else}
        <EmptyState
          icon={Trophy}
          title={t("noContestTitle")}
          description={t("noContestDesc")}
        />
      {/each}
    </div>
  </section>

  <!-- Create contest form -->
  <section
    class="rounded-4xl border border-border bg-(--color-panel) px-5 py-5 backdrop-blur-sm"
  >
    <h3 class="inline-flex items-center gap-2 text-2xl font-semibold"><Sparkles class="h-5 w-5 text-muted-foreground" /> {t("createContest")}</h3>
    <form class="mt-4 grid gap-3" method="POST" action="?/createContest" use:enhance>
      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <input
            class={inputClassName}
            name="title"
            bind:value={$form.title}
            placeholder={t("contestTitle")}
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
            placeholder="contest-slug"
            required
          />
          {#if $errors.slug}<span class="text-sm text-red-700 dark:text-red-400">{$errors.slug}</span>{/if}
        </div>
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <select class={inputClassName} name="scoringMode" bind:value={$form.scoringMode}>
          <option value="icpc">ICPC (AC + penalty)</option>
          <option value="ioi">IOI (best score)</option>
        </select>
        <div>
          <input
            class={inputClassName}
            name="submitCooldownSec"
            type="number"
            min="0"
            max="3600"
            bind:value={$form.submitCooldownSec}
            placeholder={t("cooldown")}
          />
        </div>
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <label class="inline-flex items-center gap-1 text-xs text-muted-foreground" for="scoreboardMode"><CalendarRange class="h-3.5 w-3.5" /> {t("scoreboardMode")}</label>
          <select class={inputClassName} id="scoreboardMode" name="scoreboardMode" bind:value={$form.scoreboardMode}>
            <option value="live">Live</option>
            <option value="frozen">Frozen</option>
            <option value="hidden">Hidden</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-muted-foreground" for="maxAttempts">{t("maxAttempts")}</label>
          <input
            class={inputClassName}
            id="maxAttempts"
            name="maxAttempts"
            type="number"
            min="1"
            max="999"
            placeholder={t("unlimited")}
            bind:value={$form.maxAttempts}
          />
          {#if $errors.maxAttempts}<span class="text-sm text-red-700 dark:text-red-400">{$errors.maxAttempts}</span>{/if}
        </div>
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" name="pageLockEnabled" bind:checked={$form.pageLockEnabled} />
          {t("pageLock")}
        </label>
        <!-- IP Whitelist -->
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" name="ipWhitelistEnabled" bind:checked={$form.ipWhitelistEnabled} />
          {t("whitelist")}
        </label>
      </div>
      {#if $form.ipWhitelistEnabled}
        <div class="col-span-full">
          <textarea
            class={textareaClassName}
            name="ipWhitelistText"
            bind:value={$form.ipWhitelistText}
            placeholder="CIDR ranges, one per line&#10;e.g. 140.112.0.0/16&#10;     192.168.1.0/24"
            rows="3"
          ></textarea>
        </div>
      {/if}
      <!-- IP Binding -->
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ipBindingEnabled" bind:checked={$form.ipBindingEnabled} />
        {t("ipBinding")}
      </label>
      <!-- Violation mode (show when any IP lock enabled) -->
      {#if $form.ipWhitelistEnabled || $form.ipBindingEnabled}
        <div class="col-span-full flex items-center gap-4 text-sm">
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
        <span class="text-xs text-muted-foreground">{t("allowedLanguages")}</span>
        <div class="mt-2 flex flex-wrap gap-3">
          {#each supportedLanguages as lang (lang)}
            <label class="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={($form.allowedLanguages ?? []).includes(lang)}
                onchange={() => toggleLanguage(lang)}
              />
              {lang}
            </label>
          {/each}
        </div>
        {#if $errors.allowedLanguages}<span class="text-sm text-red-700 dark:text-red-400">{$errors.allowedLanguages}</span>{/if}
      </div>
      <div>
        <textarea
          class={textareaClassName}
          name="summary"
          bind:value={$form.summary}
          placeholder={t("contestSummary")}
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
          <label class="text-xs text-muted-foreground" for="startsAt">{t("startsAt")}</label>
          <input class={inputClassName} name="startsAt" bind:value={$form.startsAt} required type="datetime-local" />
          {#if $errors.startsAt}<span class="text-sm text-red-700 dark:text-red-400">{$errors.startsAt}</span>{/if}
        </div>
        <div>
          <label class="text-xs text-muted-foreground" for="endsAt">{t("endsAt")}</label>
          <input class={inputClassName} name="endsAt" bind:value={$form.endsAt} required type="datetime-local" />
          {#if $errors.endsAt}<span class="text-sm text-red-700 dark:text-red-400">{$errors.endsAt}</span>{/if}
        </div>
        <div>
          <label class="text-xs text-muted-foreground" for="frozenAt">{t("freezeAt")}</label>
          <input class={inputClassName} name="frozenAt" bind:value={$form.frozenAt} type="datetime-local" />
        </div>
      </div>
      <button
        class="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={$submitting}
        type="submit"
      >
        {$submitting ? t("creating") : t("createContest")}
      </button>
    </form>
    {#if $formMessage}
      <p class="mt-4 text-sm text-emerald-700 dark:text-emerald-400">{$formMessage}</p>
    {/if}
  </section>
</div>
