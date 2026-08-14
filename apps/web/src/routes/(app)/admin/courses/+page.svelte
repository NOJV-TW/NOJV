<script lang="ts">
  import { GraduationCap, Users } from "@lucide/svelte";

  import type { PageData } from "./$types";
  import { m } from "$lib/paraglide/messages.js";
  import { Badge } from "$lib/components/primitives/ui/badge";
  import EmptyState from "$lib/components/primitives/ui/EmptyState.svelte";
  import PageContainer from "$lib/components/primitives/layout/PageContainer.svelte";

  let { data }: { data: PageData } = $props();
</script>

<PageContainer class="animate-in animate-in-2 space-y-5">
  <div>
    <h1 class="text-title-lg font-semibold">{m.navigation_courses()}</h1>
    <p class="mt-1 text-body-sm text-muted-foreground">{m.admin_contentCoursesDescription()}</p>
  </div>

  {#if data.courses.length === 0}
    <EmptyState icon={GraduationCap} title={m.admin_contentEmpty()} />
  {:else}
    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each data.courses as course (course.id)}
        <a
          href="/courses/{course.id}"
          class="group flex min-w-0 flex-col rounded-xl border border-border-subtle bg-[color:var(--color-panel)] p-5 shadow-rest transition-[transform,box-shadow,border-color] duration-normal ease-out-soft hover:-translate-y-px hover:border-border-strong hover:shadow-hover"
        >
          <div class="flex items-start justify-between gap-3">
            <h2 class="min-w-0 truncate text-title font-semibold">{course.title}</h2>
            <Badge variant={course.archived ? "muted" : "success"}>
              {course.archived ? m.admin_contentArchived() : m.admin_contentActive()}
            </Badge>
          </div>
          <p class="mt-1 truncate text-caption text-muted-foreground">
            {m.admin_contentOwner({ owner: course.ownerDisplayName })}
          </p>
          {#if course.academicYear != null && course.semester != null}
            <p class="mt-1 text-caption tabular-nums text-muted-foreground">
              {course.academicYear}-{course.semester}
            </p>
          {/if}
          <div class="mt-5 flex flex-wrap gap-2 border-t border-border-subtle pt-4">
            <Badge variant="muted"><Users class="size-3" />{course.memberCount}</Badge>
            <Badge variant="muted">{m.navigation_assignments()} {course.assignmentCount}</Badge>
            <Badge variant="muted">{m.navigation_exams()} {course.examCount}</Badge>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</PageContainer>
