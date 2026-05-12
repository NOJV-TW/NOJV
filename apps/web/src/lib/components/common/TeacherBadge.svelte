<script lang="ts" module>
  export type TeacherBadgeRole = "teacher" | "ta";
</script>

<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { cn } from "$lib/css.js";

  interface Props {
    role: TeacherBadgeRole;
    class?: string;
  }

  let { role, class: className }: Props = $props();

  const label = $derived(role === "ta" ? m.common_roleTa() : m.common_roleTeacher());
</script>

<span
  data-slot="teacher-badge"
  class={cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-micro font-bold uppercase tracking-[0.12em] text-primary",
    "border-[color-mix(in_oklab,var(--color-primary)_32%,transparent)]",
    "bg-[linear-gradient(135deg,color-mix(in_oklab,var(--color-primary)_14%,transparent),color-mix(in_oklab,var(--color-primary)_20%,transparent))]",
    className
  )}
>
  {label}
</span>
