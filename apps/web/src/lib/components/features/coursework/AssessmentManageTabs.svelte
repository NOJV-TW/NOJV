<script lang="ts">
  import type { Snippet } from "svelte";
  import { goto } from "$app/navigation";
  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/utils/css";
  import { Tabs } from "$lib/components/primitives/ui/tabs";
  import {
    assessmentPrimaryTab,
    assessmentSubTabHref,
    type AssessmentKind,
    type AssessmentPrimaryTab,
    type AssessmentSubTab,
  } from "./assessment-tab-state";

  let {
    kind,
    value,
    url,
    canViewClarifications,
    actions,
    children,
  }: {
    kind: AssessmentKind;
    value: AssessmentSubTab;
    url: URL;
    canViewClarifications: boolean;
    actions?: Snippet;
    children: Snippet;
  } = $props();

  const primaryTab = $derived(assessmentPrimaryTab(value));
  const tabs = $derived<{ key: AssessmentPrimaryTab; label: string }[]>([
    { key: "problems", label: m.assessmentNav_problems() },
    { key: "submissions", label: m.assessmentNav_submissions() },
    { key: "results", label: m.assessmentNav_results() },
    ...(kind === "exam"
      ? [{ key: "proctoring" as const, label: m.examDetail_subTabProctoring() }]
      : []),
    ...(canViewClarifications
      ? [{ key: "clarifications" as const, label: m.clarification_tab_title() }]
      : []),
    { key: "settings", label: m.assessmentNav_settings() },
  ]);
  const childTabs = $derived<{ key: AssessmentSubTab; label: string }[]>(
    primaryTab === "results"
      ? [
          { key: "results", label: m.assessmentNav_grades() },
          { key: "plagiarism", label: m.assessmentNav_plagiarism() },
          { key: "audit", label: m.assessmentNav_audit() },
        ]
      : primaryTab === "proctoring" && kind === "exam"
        ? [
            { key: "credentials", label: m.examCredentials_tab() },
            { key: "proctoring", label: m.examCredentials_ipRecords() },
          ]
        : [],
  );

  function selectTab(next: AssessmentSubTab): void {
    const nextUrl = assessmentSubTabHref(url, next);
    if (nextUrl === `${url.pathname}${url.search}${url.hash}`) return;
    void goto(nextUrl, { keepFocus: true, noScroll: true, replaceState: true });
  }
</script>

<Tabs
  {tabs}
  value={primaryTab}
  onValueChange={(next) => selectTab(next === "proctoring" ? "credentials" : next)}
  label={kind === "exam" ? m.examDetail_subTabsLabel() : m.assignmentDetail_sectionsNavLabel()}
  id={`${kind}-manage`}
  {...value === "submissions" && actions ? { actions } : {}}
  contentClass="p-4 sm:p-6"
>
  {#if childTabs.length > 0}
    <nav
      class="mb-6 flex flex-wrap gap-2 border-b border-border-subtle pb-4"
      aria-label={primaryTab === "results"
        ? m.assessmentNav_results()
        : m.examDetail_subTabProctoring()}
    >
      {#each childTabs as tab (tab.key)}
        <a
          href={assessmentSubTabHref(url, tab.key)}
          aria-current={value === tab.key ? "page" : undefined}
          onclick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            selectTab(tab.key);
          }}
          class={cn(
            "focus-ring inline-flex min-h-11 items-center rounded-md px-3 text-body-sm font-medium transition-colors",
            value === tab.key
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}>{tab.label}</a
        >
      {/each}
    </nav>
  {/if}
  {@render children()}
</Tabs>
