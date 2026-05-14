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
  import PageHero from "$lib/components/primitives/layout/PageHero.svelte";
  import TeacherBadge from "$lib/components/features/course/TeacherBadge.svelte";

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

{#snippet teacherActions()}
  <TeacherBadge role="teacher" />
{/snippet}

{#snippet metaContent()}
  <span>{m.course_studentCount({ count: course.studentCount })}</span>
  {#if course.ownerDisplayName}
    <span
      class="inline-block size-[3px] shrink-0 rounded-full bg-muted-foreground"
      aria-hidden="true"
    ></span>
    <span>{m.course_taughtBy({ name: course.ownerDisplayName })}</span>
  {/if}
{/snippet}

<PageHero
  variant="hub"
  {breadcrumbHref}
  breadcrumbLabel={resolvedBreadcrumbLabel}
  title={course.title}
  meta={metaContent}
  actions={isManager ? teacherActions : undefined}
  class={className}
/>
