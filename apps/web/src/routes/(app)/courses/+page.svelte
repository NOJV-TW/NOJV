<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { ArrowRight, BookOpen, GraduationCap, Plus } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { Button } from "$lib/components/primitives/ui/button";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";
  import PageHeader from "$lib/components/primitives/layout/PageHeader.svelte";
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
    goto(`?${url.searchParams.toString()}`, {
      keepFocus: true,
      replaceState: true,
      noScroll: true,
    });
  }

  const visibleCourses = $derived(activeTab === "enrolled" ? data.enrolled : data.managing);

  const tabCounts = $derived({
    enrolled: data.enrolled.length,
    managing: data.managing.length,
  });

  const showCreateButton = $derived(data.canCreate && activeTab === "managing");

  function roleLabel(role: "student" | "teacher" | "ta"): string {
    if (role === "teacher") return m.common_roleTeacher();
    if (role === "ta") return m.common_roleTa();
    return m.courses_roleStudent();
  }
</script>

<PageContainer class="fade-up">
  <PageHeader
    eyebrow={m.courses_eyebrow()}
    title={m.navigation_courses()}
    description={m.courses_subtitle()}
  >
    {#snippet icon()}
      <GraduationCap class="h-9 w-9" strokeWidth={1.6} aria-hidden="true" />
    {/snippet}
  </PageHeader>

  <div
    class="animate-in animate-in-1 mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-subtle"
  >
    <div
      role="tablist"
      aria-label={m.courses_tablistLabel()}
      class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
    >
      {#each [{ key: "enrolled" as const, label: m.courses_tabEnrolled(), count: tabCounts.enrolled }, { key: "managing" as const, label: m.courses_tabManaging(), count: tabCounts.managing }] as tab (tab.key)}
        {@const isActive = tab.key === activeTab}
        <button
          type="button"
          role="tab"
          aria-selected={isActive}
          data-tour={tab.key === "managing" ? "courses-managing" : undefined}
          onclick={() => setTab(tab.key)}
          class="-mb-px inline-flex items-center gap-2 border-b-2 px-5 py-3.5 text-body-sm font-medium transition-colors duration-fast ease-out-soft {isActive
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'}"
        >
          <span>{tab.label}</span>
          <span class="text-caption tabular-nums text-muted-foreground">{tab.count}</span>
        </button>
      {/each}
    </div>

    {#if showCreateButton}
      <Button href="/courses/new" data-tour="courses-create">
        <Plus aria-hidden="true" class="h-4 w-4" />
        {m.courses_createNew()}
      </Button>
    {/if}
  </div>

  {#if visibleCourses.length === 0}
    {#if activeTab === "enrolled"}
      <div class="animate-in animate-in-2">
        <EmptyState
          icon={GraduationCap}
          title={m.courses_emptyEnrolledTitle()}
          description={m.courses_emptyEnrolledDescription()}
          actionHref="/problems"
          actionLabel={m.courses_emptyEnrolledAction()}
        />
      </div>
    {:else if data.canCreate}
      <div class="animate-in animate-in-2" data-tour="courses-create">
        <EmptyState
          variant="onboarding"
          icon={BookOpen}
          title={m.courses_emptyManagingTitle()}
          description={m.courses_emptyManagingDescription()}
          tips={[
            m.courses_emptyManagingTip1(),
            m.courses_emptyManagingTip2(),
            m.courses_emptyManagingTip3(),
          ]}
          actions={[{ href: "/courses/new", label: m.courses_createFirst() }]}
        />
      </div>
    {:else}
      <div class="animate-in animate-in-2">
        <EmptyState
          icon={BookOpen}
          title={m.courses_emptyManagingTitle()}
          description={m.courses_emptyManagingStudentDescription()}
        />
      </div>
    {/if}
  {:else}
    <div class="animate-in animate-in-2 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {#each visibleCourses as course (course.id)}
        <a
          href={`/courses/${course.id}`}
          class="group relative flex flex-col overflow-hidden rounded-xl border border-border-subtle bg-[color:var(--color-panel)] px-7 py-7 shadow-rest backdrop-blur-sm transition-[transform,box-shadow,border-color] duration-normal ease-out-soft hover:-translate-y-0.5 hover:border-border-strong hover:shadow-hover {course.archived
            ? 'opacity-60 hover:opacity-100'
            : ''}"
        >
          <div class="mb-3.5 flex items-center justify-end">
            {#if course.role === "teacher"}
              <span class="text-caption text-muted-foreground">{m.common_roleTeacher()}</span>
            {:else if course.role === "ta"}
              <span class="text-caption text-muted-foreground">{m.common_roleTa()}</span>
            {:else}
              <span class="text-caption text-muted-foreground">{roleLabel(course.role)}</span>
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
                teacher: course.ownerDisplayName,
              })}
            {:else}
              {m.courses_subtitleStaff({
                studentCount: course.studentCount,
                assignmentCount: course.assignmentCount,
                examCount: course.examCount,
              })}
            {/if}
          </p>

          <div
            class="mt-6 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-5"
          >
            {#if course.role === "student"}
              {#if course.myAllCaughtUp}
                <span class="text-caption text-success">{m.courses_allCaughtUp()}</span>
              {:else}
                {#if course.myDueCount > 0}
                  <span class="text-caption text-warning"
                    >{m.courses_dueCount({ count: course.myDueCount })}</span
                  >
                {/if}
                {#if course.myUpcomingCount > 0}
                  <span class="text-caption text-info"
                    >{m.courses_upcomingCount({ count: course.myUpcomingCount })}</span
                  >
                {/if}
              {/if}
            {:else}
              {#if course.openAssignments > 0}
                <span class="text-caption text-success"
                  >{m.courses_openCount({ count: course.openAssignments })}</span
                >
              {/if}
              {#if course.draftAssignments > 0}
                <span class="text-caption text-muted-foreground"
                  >{m.courses_draftCount({ count: course.draftAssignments })}</span
                >
              {/if}
              {#if course.upcomingExams > 0}
                <span class="text-caption text-info"
                  >{m.courses_examCount({ count: course.upcomingExams })}</span
                >
              {/if}
              {#if course.openAssignments === 0 && course.draftAssignments === 0 && course.upcomingExams === 0}
                <span class="text-caption text-muted-foreground">{m.courses_noOpenWork()}</span>
              {/if}
            {/if}
            <span
              class="ml-auto inline-flex text-muted-foreground transition-transform duration-fast ease-out-soft group-hover:translate-x-0.5 group-hover:text-primary"
            >
              <ArrowRight aria-hidden="true" class="h-4 w-4" />
            </span>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</PageContainer>
