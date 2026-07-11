<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { enhance } from "$app/forms";
  import { Check, EyeOff, LineChart, PieChart, Share2 } from "@lucide/svelte";
  import type { EChartsOption } from "echarts";
  import { m } from "$lib/paraglide/messages.js";
  import { Card } from "$lib/components/primitives/ui/card";
  import { Button } from "$lib/components/primitives/ui/button";
  import ToggleSwitch from "$lib/components/primitives/ui/ToggleSwitch.svelte";
  import EChart from "$lib/components/primitives/charts/EChart.svelte";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import ActivityHeatmap from "$lib/components/features/dashboard/ActivityHeatmap.svelte";
  import ProfileEditCard from "$lib/components/features/account/ProfileEditCard.svelte";
  import { buildActivityModel } from "$lib/utils/activity";
  import { difficultyClass } from "$lib/utils/verdict-style";
  import { formatProblemDisplayName } from "$lib/utils/format-problem-display-name";

  let { data } = $props();

  const profile = $derived(data.profile);
  const user = $derived(data.profile.user);
  const initial = $derived(user.name.trim().charAt(0).toUpperCase() || "?");

  let profilePublic = $state(false);
  let visibilityForm: HTMLFormElement | undefined = $state();

  $effect(() => {
    profilePublic = user.profilePublic;
  });

  async function submitVisibility() {
    await tick();
    visibilityForm?.requestSubmit();
  }

  let linkCopied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  async function shareProfile() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/users/${user.id}`);
    } catch {
      return;
    }
    linkCopied = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (linkCopied = false), 2000);
  }

  onDestroy(() => clearTimeout(copyTimer));

  const activityModel = $derived(buildActivityModel(profile.activity, new Date(), 365));
  const hasHeatmapData = $derived(activityModel.heatmapDays.some((d) => d.submissionCount > 0));

  const joinedDate = $derived(
    new Date(user.createdAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
    }),
  );

  const DEFAULT_THEME_COLORS = {
    success: "#2f9d6b",
    warning: "#c98a1a",
    destructive: "#d24a3a",
    chart1: "#1d8c9c",
    chart2: "#4d6f8f",
    chart3: "#2f9d6b",
    chart4: "#c98a1a",
    chart5: "#7a8f6d",
    mutedFg: "#6b7280",
    foreground: "#1f2937",
    panel: "#ffffff",
  };
  let themeColors = $state({ ...DEFAULT_THEME_COLORS });

  function resolveThemeColors() {
    if (typeof window === "undefined") return;
    const cs = getComputedStyle(document.documentElement);
    const read = (n: string, fallback: string) => cs.getPropertyValue(n).trim() || fallback;
    themeColors = {
      success: read("--success", DEFAULT_THEME_COLORS.success),
      warning: read("--warning", DEFAULT_THEME_COLORS.warning),
      destructive: read("--destructive", DEFAULT_THEME_COLORS.destructive),
      chart1: read("--chart-1", DEFAULT_THEME_COLORS.chart1),
      chart2: read("--chart-2", DEFAULT_THEME_COLORS.chart2),
      chart3: read("--chart-3", DEFAULT_THEME_COLORS.chart3),
      chart4: read("--chart-4", DEFAULT_THEME_COLORS.chart4),
      chart5: read("--chart-5", DEFAULT_THEME_COLORS.chart5),
      mutedFg: read("--muted-foreground", DEFAULT_THEME_COLORS.mutedFg),
      foreground: read("--foreground", DEFAULT_THEME_COLORS.foreground),
      panel: read("--color-panel", DEFAULT_THEME_COLORS.panel),
    };
  }

  $effect(() => {
    resolveThemeColors();
    const observer = new MutationObserver(resolveThemeColors);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  });

  const difficultyColor = $derived<Record<string, string>>({
    easy: themeColors.success,
    medium: themeColors.warning,
    hard: themeColors.destructive,
  });

  const languagePalette = $derived([
    themeColors.chart1,
    themeColors.chart2,
    themeColors.chart3,
    themeColors.chart4,
    themeColors.chart5,
  ]);

  function pieOption(entries: { name: string; value: number; color: string }[]): EChartsOption {
    return {
      animation: false,
      tooltip: {
        trigger: "item",
        formatter: "{b}: {c} ({d}%)",
        appendToBody: true,
        extraCssText: "pointer-events:none;",
        transitionDuration: 0,
      },
      legend: {
        bottom: 0,
        textStyle: { fontSize: 11, color: themeColors.foreground },
        type: "scroll",
      },
      series: [
        {
          type: "pie",
          radius: ["40%", "70%"],
          center: ["50%", "45%"],
          avoidLabelOverlap: true,
          emphasis: { disabled: true },
          itemStyle: {
            borderRadius: 6,
            borderColor: themeColors.panel,
            borderWidth: 2,
          },
          label: { show: false },
          data: entries.map((e) => ({
            name: e.name,
            value: e.value,
            itemStyle: { color: e.color },
          })),
        },
      ],
    };
  }

  const difficultyOption = $derived(
    pieOption(
      profile.byDifficulty.map((d) => ({
        name: d.difficulty,
        value: d.acCount,
        color: difficultyColor[d.difficulty] ?? themeColors.mutedFg,
      })),
    ),
  );

  const languageOption = $derived(
    pieOption(
      profile.byLanguage.map((l, i) => ({
        name: l.language,
        value: l.count,
        color: languagePalette[i % languagePalette.length] ?? themeColors.mutedFg,
      })),
    ),
  );
</script>

<svelte:head>
  <title>{user.name} · NOJV</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl space-y-6 fade-up">
  {#if data.isOwner}
    <div class="flex flex-wrap items-center justify-end gap-x-5 gap-y-3">
      <form
        bind:this={visibilityForm}
        method="POST"
        action="?/updateProfileVisibility"
        use:enhance
        class="flex items-center gap-2.5"
        onchange={submitVisibility}
      >
        <span class="text-body-sm text-muted-foreground">{m.userProfile_publicLabel()}</span>
        <input type="hidden" name="profilePublic" value={String(profilePublic)} />
        <ToggleSwitch bind:checked={profilePublic} />
      </form>
      <Button variant="outline" size="sm" onclick={shareProfile}>
        {#if linkCopied}
          <Check aria-hidden="true" class="text-primary" />
          {m.userProfile_linkCopied()}
        {:else}
          <Share2 aria-hidden="true" />
          {m.userProfile_share()}
        {/if}
      </Button>
    </div>
  {/if}

  <Card variant="surface" size="lg">
    <div class="flex flex-wrap items-center gap-5">
      <div
        class="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-primary text-title font-semibold text-primary-foreground"
      >
        {#if user.image}
          <img src={user.image} alt={user.name} class="size-full object-cover" />
        {:else}
          {initial}
        {/if}
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="text-headline font-semibold leading-tight">{user.name}</h1>
          {#if !user.profilePublic}
            <span
              class="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-0.5 text-caption font-medium text-muted-foreground"
            >
              <EyeOff class="size-3.5" />
              {m.userProfile_privateBadge()}
            </span>
          {/if}
        </div>
        {#if user.username}
          <p class="mt-0.5 font-mono text-body-sm text-muted-foreground">@{user.username}</p>
        {/if}
        <p class="mt-1 text-caption text-muted-foreground">
          {m.userProfile_joined({ date: joinedDate })}
        </p>
      </div>
      <div class="flex flex-col items-end gap-0.5">
        <span class="text-headline font-semibold tabular-nums">
          {profile.solvedProblems.length}
        </span>
        <span class="text-caption text-muted-foreground">{m.userProfile_solvedCount()}</span>
      </div>
    </div>
    {#if !user.profilePublic && data.isOwner}
      <p class="mt-4 border-t border-border-subtle pt-4 text-caption text-muted-foreground">
        {m.userProfile_privateHint()}
      </p>
    {/if}
  </Card>

  {#if data.owner}
    <ProfileEditCard
      owner={data.owner}
      name={user.name}
      username={user.username}
      image={user.image}
    />
  {/if}

  <Card variant="surface" size="lg">
    {#if hasHeatmapData}
      <ActivityHeatmap data={activityModel.heatmapDays} title={m.userProfile_activity()} />
    {:else}
      <h2 class="mb-4 text-title-sm font-semibold">{m.userProfile_activity()}</h2>
      <EmptyState variant="minimal" icon={LineChart} title={m.userProfile_noActivity()} />
    {/if}
  </Card>

  <div class="grid gap-4 md:grid-cols-2">
    <Card variant="surface" size="lg">
      <h2 class="mb-4 text-title-sm font-semibold">{m.userProfile_difficultyDist()}</h2>
      {#if profile.byDifficulty.length > 0}
        <EChart option={difficultyOption} class="h-56 w-full" />
      {:else}
        <EmptyState variant="minimal" icon={PieChart} title={m.userProfile_noActivity()} />
      {/if}
    </Card>
    <Card variant="surface" size="lg">
      <h2 class="mb-4 text-title-sm font-semibold">{m.userProfile_languageDist()}</h2>
      {#if profile.byLanguage.length > 0}
        <EChart option={languageOption} class="h-56 w-full" />
      {:else}
        <EmptyState variant="minimal" icon={PieChart} title={m.userProfile_noActivity()} />
      {/if}
    </Card>
  </div>

  <Card variant="surface" size="lg">
    <h2 class="mb-4 text-title-sm font-semibold">{m.userProfile_solvedHeading()}</h2>
    {#if profile.solvedProblems.length > 0}
      <ul class="divide-y divide-border-subtle">
        {#each profile.solvedProblems as problem (problem.id)}
          <li class="flex items-center justify-between gap-4 py-3">
            <a
              href="/problems/{problem.id}"
              class="min-w-0 truncate font-medium hover:underline"
            >
              {formatProblemDisplayName(problem)}
            </a>
            <span
              class="inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-caption font-semibold capitalize {difficultyClass(
                problem.difficulty,
              )}"
            >
              {problem.difficulty}
            </span>
          </li>
        {/each}
      </ul>
    {:else}
      <EmptyState variant="minimal" icon={PieChart} title={m.userProfile_noSolved()} />
    {/if}
  </Card>
</div>
