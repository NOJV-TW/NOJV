<script lang="ts">
  import { ChevronLeft } from "@lucide/svelte";
  import { m } from "$lib/paraglide/messages.js";
  import type { LayoutData } from "./$types";

  interface Props {
    data: LayoutData;
    children?: import("svelte").Snippet;
  }

  let { data, children }: Props = $props();
</script>

<div class="w-full px-6 py-6">
  <a
    href={`/courses/${data.course.id}`}
    class="inline-flex items-center gap-1 text-body-sm text-muted-foreground transition-colors duration-fast ease-out-soft hover:text-foreground"
  >
    <ChevronLeft class="size-4" aria-hidden="true" />
    <span>{m.assignmentShell_backToCourse({ course: data.course.title })}</span>
  </a>
  {@render children?.()}
</div>
