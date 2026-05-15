<script lang="ts" module>
  export type CourseTabKey =
    | "overview"
    | "assignments"
    | "exams"
    | "members"
    | "analytics"
    | "settings";

  export interface CourseTabCounts {
    assignments?: number;
    exams?: number;
    members?: number;
  }
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/utils/css.js";

  interface Props {
    courseId: string;
    activeTabKey: CourseTabKey;
    counts?: CourseTabCounts;
    showAnalytics: boolean;
    showSettings: boolean;
    class?: string;
  }

  let {
    courseId,
    activeTabKey,
    counts,
    showAnalytics,
    showSettings,
    class: className
  }: Props = $props();

  interface TabDef {
    key: CourseTabKey;
    label: string;
    href: string;
    count?: number;
  }

  function makeTab(
    key: CourseTabKey,
    label: string,
    href: string,
    count: number | undefined
  ): TabDef {
    return count === undefined ? { key, label, href } : { key, label, href, count };
  }

  const tabs = $derived<TabDef[]>([
    makeTab("overview", m.course_tabOverview(), `/courses/${courseId}`, undefined),
    makeTab(
      "assignments",
      m.course_tabAssignments(),
      `/courses/${courseId}/assignments`,
      counts?.assignments
    ),
    makeTab(
      "exams",
      m.course_tabExams(),
      `/courses/${courseId}/exams`,
      counts?.exams
    ),
    makeTab(
      "members",
      m.course_tabMembers(),
      `/courses/${courseId}/members`,
      counts?.members
    ),
    ...(showAnalytics
      ? [
          makeTab(
            "analytics",
            m.course_tabAnalytics(),
            `/courses/${courseId}/analytics`,
            undefined
          )
        ]
      : []),
    ...(showSettings
      ? [
          makeTab(
            "settings",
            m.course_tabSettings(),
            `/courses/${courseId}/settings`,
            undefined
          )
        ]
      : [])
  ]);
</script>

<nav
  data-slot="course-tab-bar"
  aria-label={m.course_tabBarLabel()}
  class={cn(
    "sticky top-[60px] z-10 mb-10 border-b border-border bg-[color:var(--color-background)]/90 backdrop-blur-md",
    className
  )}
>
  <div class="flex items-center gap-1">
    {#each tabs as tab (tab.key)}
      {@const isActive = tab.key === activeTabKey}
      <a
        href={tab.href}
        aria-current={isActive ? "page" : undefined}
        class={cn(
          "-mb-px inline-flex items-center gap-2 border-b-2 px-5 py-3.5 text-body-sm font-medium transition-colors duration-fast ease-out-soft",
          isActive
            ? "border-primary text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
        )}
      >
        <span>{tab.label}</span>
        {#if tab.count !== undefined}
          <span
            class={cn(
              "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-micro font-semibold tabular-nums",
              isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            )}
          >
            {tab.count}
          </span>
        {/if}
      </a>
    {/each}
  </div>
</nav>
