<script lang="ts">
  import { settingsForm } from "./teacher-refresh-data";
  import AssignmentSettingsTab from "$lib/components/features/course/assignment/AssignmentSettingsTab.svelte";
  let context = $state("assignment-A");
  let form = $state(settingsForm("Original title"));
  export function refresh(id: string, title: string) {
    context = id;
    form = settingsForm(title);
  }
  const schedule = {
    opensAt: "2026-09-21T00:00:00Z",
    dueAt: "2026-09-21T01:00:00Z",
    closesAt: "2026-09-21T02:00:00Z",
  };
</script>

{#key context}
  <AssignmentSettingsTab {form} liveStatus="draft" initialSchedule={schedule} />
{/key}
