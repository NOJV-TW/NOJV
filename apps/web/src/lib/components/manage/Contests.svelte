<script lang="ts">
  import { CalendarRange, Shield, Sparkles, Trophy } from "@lucide/svelte";
  import { untrack } from "svelte";
  import { superForm, type SuperValidated } from "sveltekit-superforms";
  import {
    supportedLanguages,
    type ContestScoringMode,
    type ScoreboardMode
  } from "@nojv/core";
  import { inputClassName, toDateTimeLocalValue, toggleArrayItem } from "$lib/utils";
  import type { contestDomain } from "@nojv/domain";
  type ContestListItem = contestDomain.ContestListItem;
  import EmptyState from "$lib/components/ui/EmptyState.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import SystemTextToggle, { type UiLang } from "./SystemTextToggle.svelte";
  import FormError from "$lib/components/ui/FormError.svelte";
  import type { FormMessage } from "$lib/types/form-message";

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
      pageLockEnabled: boolean;
      problemIdsText: string;
      scoreboardMode: ScoreboardMode;
      scoringMode: ContestScoringMode;
      slug: string;
      startsAt: string;
      submitCooldownSec: number;
      summary: string;
      title: string;
    }>;
    problemIds: string[];
  }

  let { contests, courseSlug, form: formData, problemIds }: Props = $props();
  const initialProblemSlugs = untrack(() => problemIds);

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
      freezeAt: "Freeze at (optional)",
      noContestDesc: "Create your first contest below.",
      noContestTitle: "No contests yet",
      notifyOnly: "Notify only",
      pageLock: "Page lock (prevent tab switching)",
      participants: "participants",
      problems: "problems",
      scoreboardMode: "Scoreboard mode",
      startsAt: "Starts at",
      systemText: "System Text",
      whenIpViolation: "When IP violation occurs:",
      whitelist: "IP Whitelist",
      ipBinding: "IP First-Binding (lock to first IP used)"
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
      freezeAt: "凍結時間（可選）",
      noContestDesc: "在下方建立第一個競賽。",
      noContestTitle: "尚未建立競賽",
      notifyOnly: "僅通知",
      pageLock: "分頁鎖定（避免切換分頁）",
      participants: "參與者",
      problems: "題",
      scoreboardMode: "記分板模式",
      startsAt: "開始時間",
      systemText: "系統文字",
      whenIpViolation: "發生 IP 違規時：",
      whitelist: "IP 白名單",
      ipBinding: "IP 首次綁定（鎖定首次使用 IP）"
    }
  } as const;

  function t<K extends keyof (typeof text)["en"]>(key: K): string {
    return text[uiLang][key];
  }

  function toggleLanguage(lang: string) {
    $form.allowedLanguages = toggleArrayItem($form.allowedLanguages ?? [], lang);
  }

  const textareaClassName = `${inputClassName} min-h-24 resize-y`;

  const defaultStart = toDateTimeLocalValue(new Date());
  const defaultEnd = toDateTimeLocalValue(
    new Date(Date.now() + 1000 * 60 * 60 * 3)
  );

  const {
    form,
    errors,
    submitting,
    message: formMessage,
    enhance
  } = superForm<typeof formData.data, FormMessage>(untrack(() => formData), {
    dataType: "json",
    invalidateAll: true
  });

  if (!$form.startsAt) $form.startsAt = defaultStart;
  if (!$form.endsAt) $form.endsAt = defaultEnd;
  if (!$form.problemIdsText) $form.problemIdsText = initialProblemSlugs.join(", ");
  if (!$form.scoringMode) $form.scoringMode = "problem_count";
</script>

<div class="space-y-6">
  <div class="flex justify-end">
    <SystemTextToggle bind:value={uiLang} label={t("systemText")} />
  </div>

  <!-- Existing contests -->
  <section
    class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-6 py-6 shadow-rest backdrop-blur-sm"
  >
    <div class="flex items-center justify-between gap-4">
      <h3 class="inline-flex items-center gap-2 font-display text-title font-semibold"><Trophy class="h-5 w-5 text-muted-foreground" /> {t("contests")}</h3>
      <Badge variant="muted" size="md" class="tabular-nums">
        {contests.length}
      </Badge>
    </div>
    <div class="mt-5 grid gap-3">
      {#each contests as contest (contest.slug)}
        <article
          class="rounded-sm border border-border-subtle bg-[color:var(--color-panel)] px-4 py-4"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-body-sm uppercase tracking-[0.18em] text-muted-foreground">
                {contest.scoringMode}
              </p>
              <a href="/contests/{contest.slug}" class="mt-2 text-body-lg font-semibold transition-colors duration-fast ease-out-soft hover:underline">
                {contest.title}
              </a>
            </div>
            <Badge variant="muted" size="md" class="tabular-nums">
              {contest.problemCount} {t("problems")}
            </Badge>
          </div>
          <p class="mt-2 text-body-sm text-muted-foreground tabular-nums">
            {contest.startsAt.slice(0, 10)} &rarr; {contest.endsAt.slice(0, 10)}
            &middot; {contest.participantCount} {t("participants")}
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            {#if contest.pageLockEnabled}<Badge variant="outline" size="xs">page-lock</Badge>{/if}
            {#if contest.ipWhitelistEnabled}<Badge variant="outline" size="xs">ip-whitelist</Badge>{/if}
            {#if contest.ipBindingEnabled}<Badge variant="outline" size="xs">ip-binding</Badge>{/if}
            <Badge variant="outline" size="xs">{contest.scoreboardMode} scoreboard</Badge>
            {#if contest.allowedLanguages.length > 0}
              <Badge variant="outline" size="xs">{contest.allowedLanguages.join(", ")}</Badge>
            {:else}
              <Badge variant="outline" size="xs">{t("allLanguages")}</Badge>
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
    class="rounded-2xl border border-border bg-[color:var(--color-panel)] px-6 py-6 shadow-rest backdrop-blur-sm"
  >
    <h3 class="inline-flex items-center gap-2 font-display text-title font-semibold"><Sparkles class="h-5 w-5 text-muted-foreground" /> {t("createContest")}</h3>
    <form class="mt-4 grid gap-3" method="POST" action="?/createContest" use:enhance>
      <FormError message={$formMessage?.kind === "error" ? $formMessage.text : null} />
      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <input
            class={inputClassName}
            name="title"
            bind:value={$form.title}
            placeholder={t("contestTitle")}
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
            placeholder="contest-slug"
            required
          />
          {#if $errors.slug}<span class="text-body-sm text-destructive">{$errors.slug}</span>{/if}
        </div>
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <select class={inputClassName} name="scoringMode" bind:value={$form.scoringMode}>
          <option value="problem_count">Problem count (ICPC-style, penalty tiebreaker)</option>
          <option value="point_sum">Point sum (IOI-style, partial credit)</option>
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
      <div>
        <label class="inline-flex items-center gap-1 text-xs text-muted-foreground" for="scoreboardMode"><CalendarRange class="h-3.5 w-3.5" /> {t("scoreboardMode")}</label>
        <select class={inputClassName} id="scoreboardMode" name="scoreboardMode" bind:value={$form.scoreboardMode}>
          <option value="live">Live</option>
          <option value="frozen">Frozen</option>
          <option value="hidden">Hidden</option>
        </select>
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        <label class="flex items-center gap-2 text-body-sm">
          <input type="checkbox" name="pageLockEnabled" bind:checked={$form.pageLockEnabled} />
          {t("pageLock")}
        </label>
        <!-- IP Whitelist -->
        <label class="flex items-center gap-2 text-body-sm">
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
      <label class="flex items-center gap-2 text-body-sm">
        <input type="checkbox" name="ipBindingEnabled" bind:checked={$form.ipBindingEnabled} />
        {t("ipBinding")}
      </label>
      <!-- Violation mode (show when any IP lock enabled) -->
      {#if $form.ipWhitelistEnabled || $form.ipBindingEnabled}
        <div class="col-span-full flex items-center gap-4 text-body-sm">
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
        <span class="text-caption text-muted-foreground">{t("allowedLanguages")}</span>
        <div class="mt-2 flex flex-wrap gap-3">
          {#each supportedLanguages as lang (lang)}
            <label class="flex items-center gap-1.5 text-body-sm">
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
        {#if $errors.allowedLanguages}<span class="text-body-sm text-destructive">{$errors.allowedLanguages}</span>{/if}
      </div>
      <div>
        <textarea
          class={textareaClassName}
          name="summary"
          bind:value={$form.summary}
          placeholder={t("contestSummary")}
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
          <label class="text-caption text-muted-foreground" for="startsAt">{t("startsAt")}</label>
          <input class={inputClassName} name="startsAt" bind:value={$form.startsAt} required type="datetime-local" />
          {#if $errors.startsAt}<span class="text-body-sm text-destructive">{$errors.startsAt}</span>{/if}
        </div>
        <div>
          <label class="text-caption text-muted-foreground" for="endsAt">{t("endsAt")}</label>
          <input class={inputClassName} name="endsAt" bind:value={$form.endsAt} required type="datetime-local" />
          {#if $errors.endsAt}<span class="text-body-sm text-destructive">{$errors.endsAt}</span>{/if}
        </div>
        <div>
          <label class="text-caption text-muted-foreground" for="frozenAt">{t("freezeAt")}</label>
          <input class={inputClassName} name="frozenAt" bind:value={$form.frozenAt} type="datetime-local" />
        </div>
      </div>
      <Button type="submit" loading={$submitting} disabled={$submitting} class="w-fit rounded-full px-5">
        {$submitting ? t("creating") : t("createContest")}
      </Button>
    </form>
    {#if $formMessage?.kind === "success"}
      <p class="mt-4 text-body-sm text-success">{$formMessage.text}</p>
    {/if}
  </section>
</div>
