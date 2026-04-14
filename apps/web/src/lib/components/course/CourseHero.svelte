<script lang="ts" module>
  export interface CourseHeroCourse {
    id: string;
    title: string;
    studentCount: number;
    ownerDisplayName?: string;
  }
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/utils.js";
  import { ChevronLeft } from "@lucide/svelte";
  import TeacherBadge from "$lib/components/common/TeacherBadge.svelte";

  interface Props {
    course: CourseHeroCourse;
    isManager: boolean;
    breadcrumbHref?: string;
    breadcrumbLabel?: string;
    class?: string;
  }

  let {
    course,
    isManager,
    breadcrumbHref = "/courses",
    breadcrumbLabel,
    class: className
  }: Props = $props();

  const resolvedBreadcrumbLabel = $derived(breadcrumbLabel ?? m.navigation_courses());
</script>

<section
  data-slot="course-hero"
  class={cn("border-b border-border pb-7 pt-8", className)}
>
  <a
    href={breadcrumbHref}
    class="inline-flex items-center gap-1 text-body-sm text-muted-foreground transition-colors duration-fast ease-out-soft hover:text-foreground"
  >
    <ChevronLeft class="size-4" aria-hidden="true" />
    <span>{resolvedBreadcrumbLabel}</span>
  </a>

  <div class="mt-4 flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0 flex-1">
      <h1
        class="font-display text-display font-normal leading-none tracking-[-0.025em]"
      >
        {course.title}
      </h1>
      <div class="mt-3.5 flex flex-wrap items-center gap-5 text-body-sm text-muted-foreground">
        <span>{m.course_studentCount({ count: course.studentCount })}</span>
        {#if course.ownerDisplayName}
          <span
            class="inline-block size-[3px] shrink-0 rounded-full bg-muted-foreground"
            aria-hidden="true"
          ></span>
          <span>{m.course_taughtBy({ name: course.ownerDisplayName })}</span>
        {/if}
      </div>
    </div>
    {#if isManager}
      <TeacherBadge role="teacher" />
    {/if}
  </div>
</section>
