import { describe, expect, it } from "vitest";

import { avatarSrc } from "$lib/utils/avatar-src";

describe("avatarSrc", () => {
  it("serves third-party avatars through the same-origin image proxy", () => {
    const google = "https://lh3.googleusercontent.com/a/ACg8oc=s96-c";
    expect(avatarSrc(google)).toBe(`/api/images/proxy?url=${encodeURIComponent(google)}`);
    expect(avatarSrc("//cdn.example/a.png")).toBe(
      `/api/images/proxy?url=${encodeURIComponent("//cdn.example/a.png")}`,
    );
  });

  it("keeps first-party uploaded avatars unchanged", () => {
    const uploaded = "/api/storage/avatars/user-1/abc.webp";
    expect(avatarSrc(uploaded)).toBe(uploaded);
  });

  it("uses the initials fallback for anonymous remote-avatar views", () => {
    expect(avatarSrc("https://avatars.example/user.png", false)).toBeUndefined();
    expect(avatarSrc("//avatars.example/user.png", false)).toBeUndefined();
    expect(avatarSrc("/api/storage/avatars/user-1/abc.webp", false)).toBe(
      "/api/storage/avatars/user-1/abc.webp",
    );
  });
});
