import { describe, expect, it } from "vitest";

import { localActorPresets } from "@nojv/domain";

import {
  buildWorkspaceActorSearch,
  resolveWorkspaceActor,
  workspaceActorStorageKey
} from "./actor-session";

describe("resolveWorkspaceActor", () => {
  it("prefers actor identity from workspace launch query params", () => {
    const search = buildWorkspaceActorSearch("?mode=assignment", localActorPresets.teacher);

    expect(
      resolveWorkspaceActor({
        search,
        storedActor: JSON.stringify(localActorPresets.student)
      })
    ).toEqual(localActorPresets.teacher);
  });

  it("falls back to the stored actor when launch params do not provide one", () => {
    expect(
      resolveWorkspaceActor({
        search: "?mode=practice",
        storedActor: JSON.stringify(localActorPresets.ta)
      })
    ).toEqual(localActorPresets.ta);
  });

  it("falls back to the default actor when neither query nor storage is usable", () => {
    expect(
      resolveWorkspaceActor({
        search: "?mode=practice",
        storedActor: "{broken-json"
      })
    ).toEqual(localActorPresets.student);
  });
});

describe("workspaceActorStorageKey", () => {
  it("uses a stable storage key for actor persistence", () => {
    expect(workspaceActorStorageKey).toBe("nojv.workspace-actor");
  });
});
