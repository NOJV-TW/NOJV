import { describe, expect, it } from "vitest";

import {
  buildActorRequestHeaders,
  localActorPresets,
  readActorIdentityFromSearchParams,
  writeActorIdentityToSearchParams
} from "../src/index";

describe("buildActorRequestHeaders", () => {
  it("serializes the selected actor into nojv request headers", () => {
    const headers = buildActorRequestHeaders(localActorPresets.teacher);

    expect(headers).toEqual({
      "x-nojv-actor-id": "usr_teacher_amelia",
      "x-nojv-display-name": "Amelia Chen",
      "x-nojv-email": "amelia.chen@nojv.local",
      "x-nojv-handle": "teacher_amelia",
      "x-nojv-platform-role": "teacher"
    });
  });
});

describe("actor identity search params", () => {
  it("round-trips actor identity through URLSearchParams", () => {
    const params = writeActorIdentityToSearchParams(
      new URLSearchParams("mode=assignment&course=os-lab-spring-2026"),
      localActorPresets.student
    );

    expect(params.toString()).toContain("mode=assignment");
    expect(readActorIdentityFromSearchParams(params)).toEqual(localActorPresets.student);
  });
});
