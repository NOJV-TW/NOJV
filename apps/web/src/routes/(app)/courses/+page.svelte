<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { ArrowRight, BookOpen, GraduationCap, Plus } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import PageContainer from "$lib/components/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/layout/PageHeader.svelte";
  import TeacherBadge from "$lib/components/common/TeacherBadge.svelte";
  import type { PageData } from "./$types";

  type TabKey = "enrolled" | "managing";

  let { data }: { data: PageData } = $props();

  const activeTab = $derived<TabKey>(deriveTab(page.url.searchParams.get("tab")));

  function deriveTab(raw: string | null): TabKey {
    if (raw === "managing") return "managing";
    return "enrolled";
  }

  function setTab(next: TabKey) {
    const url = new URL(page.url);
    url.searchParams.set("tab", next);
    goto(`?${url.searchParams.toString()}`, { keepFocus: true, replaceState: true, noScroll: true });
  }

  const visibleCourses = $derived(activeTab === "enrolled" ? data.enrolled : data.managing);

  const tabCounts = $derived({
    enrolled: data.enrolled.length,
    managing: data.managing.length
  });

  const showCreateButton = $derived(data.canCreate && activeTab === "managing");

  function roleLabel(role: "student" | "teacher" | "ta"): string {
    if (role === "teacher") return m.common_roleTeacher();
    if (role === "ta") return m.common_roleTa();
    return m.courses_roleStudent();
  }
</script>

<PageContainer>
  <PageHeader
    eyebrow={m.courses_eyebrow()}
    title={m.navigation_courses()}
    description={m.courses_subtitle()}
  />

  <div class="animate-in animate-in-1 mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border">
    <div role="tablist" aria-label="Course tabs" class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {#each [{ key: "enrolled" as const, label: m.courses_tabEnrolled(), count: tabCounts.enrolled }, { key: "managing" as const, label: m.courses_tabManaging(), count: tabCounts.managing }] as tab (tab.key)}
        {@const isActive = tab.key === activeTab}
        <button
          type="button"
          role="tab"
          aria-selected={isActive}
          onclick={() => setTab(tab.key)}
          class="-mb-px inline-flex items-center gap-2 border-b-2 px-5 py-3.5 text-body-sm font-medium transition-colors duration-fast ease-out-soft {isActive
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'}"
        >
          <span>{tab.label}</span>
          <span
            class="inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-micro font-semibold tabular-nums {isActive
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'}"
          >
            {tab.count}
          </span>
        </button>
      {/each}
    </div>

    {#if showCreateButton}
      <Button href="/courses/new">
        <Plus class="h-4 w-4" />
        {m.courses_createNew()}
      </Button>
    {/if}
  </div>

  {#if visibleCourses.length === 0}
    {#if activeTab === "enrolled"}
      <div
        class="animate-in animate-in-2 rounded-2xl border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-8 py-12 text-center"
      >
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-muted/60">
          <GraduationCap class="h-7 w-7 text-muted-foreground/70" />
        </div>
        <h3 class="mt-4 text-title font-medium">{m.courses_emptyEnrolledTitle()}</h3>
        <p class="mt-2 text-body-sm text-muted-foreground">
          {m.courses_emptyEnrolledDescription()}
        </p>
      </div>
    {:else}
      <div
        class="animate-in animate-in-2 rounded-2xl border border-dashed border-border-strong bg-[color:var(--color-panel)]/60 px-8 py-12 text-center"
      >
        <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-muted/60">
          <BookOpen class="h-7 w-7 text-muted-foreground/70" />
        </div>
        <h3 class="mt-4 text-title font-medium">{m.courses_emptyManagingTitle()}</h3>
        <p class="mt-2 text-body-sm text-muted-foreground">
          {m.courses_emptyManagingDescription()}
        </p>
        {#if data.canCreate}
          <div class="mt-5">
            <Button href="/courses/new">
              <Plus class="h-4 w-4" />
              {m.courses_createFirst()}
            </Button>
          </div>
        {/if}
      </div>
    {/if}
  {:else}
    <div class="animate-in animate-in-2 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {#each visibleCourses as course (course.id)}
        <a
          href={`/courses/${course.id}`}
          class="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-[color:var(--color-panel)] px-7 py-7 shadow-rest backdrop-blur-sm transition-[transform,box-shadow,border-color] duration-normal ease-out-soft hover:-translate-y-0.5 hover:border-border-strong hover:shadow-hover {course.archived
            ? 'opacity-60 hover:opacity-100'
            : ''}"
        >
          <div class="mb-3.5 flex items-center justify-between gap-3">
            <span
              class="font-mono text-caption uppercase tracking-[0.08em] text-muted-foreground"
            >
              {course.id.slice(0, 8)}
            </span>
            {#if course.role === "teacher"}
              <TeacherBadge role="teacher" />
            {:else if course.role === "ta"}
              <TeacherBadge role="ta" />
            {:else}
              <Badge variant="muted">{roleLabel(course.role)}</Badge>
            {/if}
          </div>

          <h3 class="text-title font-medium leading-tight tracking-tight">
            {course.title}
          </h3>
          {#if course.academicYear != null && course.semester != null}
            <span class="mt-1 inline-block text-caption tabular-nums text-muted-foreground">
              {course.academicYear}-{course.semester}
            </span>
          {/if}

          <p class="mt-1.5 text-body-sm text-muted-foreground">
            {#if course.role === "student"}
              {m.courses_subtitleStudent({
                studentCount: course.studentCount,
                teacher: course.ownerDisplayName
              })}
            {:else}
              {m.courses_subtitleStaff({
                studentCount: course.studentCount,
                assignmentCount: course.assignmentCount,
                examCount: course.examCount
              })}
            {/if}
          </p>

          <div
            class="mt-6 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-5"
          >
            {#if course.role === "student"}
              {#if course.myAllCaughtUp}
                <Badge variant="success" dot>{m.courses_allCaughtUp()}</Badge>
              {:else}
                {#if course.myDueCount > 0}
                  <Badge variant="warning" dot
                    >{m.courses_dueCount({ count: course.myDueCount })}</Badge
                  >
                {/if}
                {#if course.myUpcomingCount > 0}
                  <Badge variant="info">{m.courses_upcomingCount({ count: course.myUpcomingCount })}</Badge>
                {/if}
              {/if}
            {:else}
              {#if course.openAssignments > 0}
                <Badge variant="default" dot
                  >{m.courses_openCount({ count: course.openAssignments })}</Badge
                >
              {/if}
              {#if course.draftAssignments > 0}
                <Badge variant="muted"
                  >{m.courses_draftCount({ count: course.draftAssignments })}</Badge
                >
              {/if}
              {#if course.upcomingExams > 0}
                <Badge variant="info"
                  >{m.courses_examCount({ count: course.upcomingExams })}</Badge
                >
              {/if}
              {#if course.openAssignments === 0 && course.draftAssignments === 0 && course.upcomingExams === 0}
                <Badge variant="muted">{m.courses_noOpenWork()}</Badge>
              {/if}
            {/if}
            <span
              class="ml-auto inline-flex text-muted-foreground transition-transform duration-fast ease-out-soft group-hover:translate-x-0.5 group-hover:text-primary"
            >
              <ArrowRight class="h-4 w-4" />
            </span>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</PageContainer>
