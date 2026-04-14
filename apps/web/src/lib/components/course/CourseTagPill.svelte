<script lang="ts" module>
  export type CourseTagAccent = "primary" | "info" | "success";
</script>

<script lang="ts">
  import { cn } from "$lib/utils.js";

  interface Props {
    courseId: string;
    title: string;
    accentColor?: CourseTagAccent;
    class?: string;
  }

  let { courseId, title, accentColor = "primary", class: className }: Props = $props();

  const dotClass = $derived(
    accentColor === "info"
      ? "bg-info"
      : accentColor === "success"
        ? "bg-success"
        : "bg-primary"
  );
</script>

<a
  data-slot="course-tag-pill"
  href={`/courses/${courseId}`}
  class={cn(
    "inline-flex items-center gap-1.5 rounded-full border border-border bg-[color:var(--color-panel)] px-2.5 py-1 text-caption font-medium text-muted-foreground transition-[color,border-color] duration-fast ease-out-soft hover:border-border-strong hover:text-foreground",
    className
  )}
>
  <span class={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} aria-hidden="true"></span>
  <span class="truncate">{title}</span>
</a>
