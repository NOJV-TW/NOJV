import type { AssessmentSettingsFormData } from "@nojv/core";
import type { SuperValidated } from "sveltekit-superforms";
import type { FormMessage } from "$lib/types/form-message";
export function settingsForm(
  title: string,
): SuperValidated<AssessmentSettingsFormData, FormMessage> {
  return {
    id: "teacher-settings",
    valid: true,
    posted: false,
    errors: {},
    data: {
      title,
      summary: "",
      opensAt: "2026-09-21T00:00:00Z",
      dueAt: "2026-09-21T01:00:00Z",
      closesAt: "2026-09-21T02:00:00Z",
      allowedLanguages: ["python"],
      maxAttemptsPerDay: null,
      attemptResetMinuteOfDay: null,
      allowLateSubmissions: false,
      latePenalty: null,
    },
  };
}

export interface TeacherProblemSnapshot {
  id: string;
  totalPoints: number;
  gradingRevision: number;
  problems: { id: string; title: string; points: number }[];
}
