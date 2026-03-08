import { describe, expect, it } from "vitest";

import { localActorPresets } from "@nojv/domain";

import { buildWorkspaceLaunchUrl, resolveWorkspaceAppUrl } from "../src/lib/workspace-launch";

describe("resolveWorkspaceAppUrl", () => {
  it("uses NEXT_PUBLIC_WORKSPACE_URL when present", () => {
    expect(
      resolveWorkspaceAppUrl({
        NEXT_PUBLIC_WORKSPACE_URL: "https://workspace.nojv.dev/"
      })
    ).toBe("https://workspace.nojv.dev");
  });

  it("falls back to the local workspace origin when the env var is absent", () => {
    expect(resolveWorkspaceAppUrl({})).toBe("http://localhost:4173");
  });
});

describe("buildWorkspaceLaunchUrl", () => {
  it("preserves course assessment context in workspace launch links", () => {
    expect(
      buildWorkspaceLaunchUrl("https://workspace.nojv.dev", {
        assessment: {
          assessmentSlug: "hw1-process-trace",
          courseSlug: "os-lab-spring-2026",
          kind: "assignment"
        }
      })
    ).toBe(
      "https://workspace.nojv.dev/?mode=assignment&course=os-lab-spring-2026&assessment=hw1-process-trace"
    );
  });

  it("preserves contest context in workspace launch links", () => {
    expect(
      buildWorkspaceLaunchUrl("https://workspace.nojv.dev/platform", {
        contestSlug: "spring-qualifier-2026"
      })
    ).toBe("https://workspace.nojv.dev/platform/?mode=contest&contest=spring-qualifier-2026");
  });

  it("embeds the selected actor so workspace execution keeps the same identity", () => {
    expect(
      buildWorkspaceLaunchUrl("https://workspace.nojv.dev", {
        actor: localActorPresets.teacher,
        assessment: {
          assessmentSlug: "hw1-process-trace",
          courseSlug: "os-lab-spring-2026",
          kind: "assignment"
        }
      })
    ).toBe(
      "https://workspace.nojv.dev/?mode=assignment&course=os-lab-spring-2026&assessment=hw1-process-trace&actorName=Amelia+Chen&actorEmail=amelia.chen%40nojv.local&actorHandle=teacher_amelia&actorRole=teacher&actorId=usr_teacher_amelia"
    );
  });
});
