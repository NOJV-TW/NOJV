<script lang="ts">
  import { Search, Shield } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Card } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import FormField from "$lib/components/ui/FormField.svelte";
  import type { UsersPageLabels } from "./labels";

  interface Props {
    search: string;
    role: string;
    labels: UsersPageLabels;
    onApply: () => void;
  }

  let { search = $bindable(), role = $bindable(), labels, onApply }: Props = $props();
</script>

<Card variant="flat" size="md">
  <div class="flex flex-wrap items-end gap-3">
    <div class="min-w-[240px] flex-1">
      <FormField label={labels.search} for="search">
        <Input
          id="search"
          placeholder={labels.searchPlaceholder}
          type="text"
          bind:value={search}
          onkeydown={(e) => e.key === "Enter" && onApply()}
        />
      </FormField>
    </div>
    <div>
      <label
        class="mb-1.5 inline-flex items-center gap-1 text-body-sm font-medium"
        for="role-filter"
      >
        <Shield class="h-3.5 w-3.5 text-muted-foreground" /> {labels.role}
      </label>
      <select
        id="role-filter"
        class="flex h-11 w-full min-w-0 rounded-sm border border-input bg-background px-3 py-2 text-body shadow-rest outline-none transition-[border-color,box-shadow] duration-fast ease-out-soft focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        bind:value={role}
        onchange={onApply}
      >
        <option value="">{labels.allRoles}</option>
        <option value="admin">Admin</option>
        <option value="teacher">Teacher</option>
        <option value="student">Student</option>
      </select>
    </div>
    <Button variant="default" type="button" onclick={onApply}>
      <Search class="h-4 w-4" />
      {labels.search}
    </Button>
  </div>
</Card>
