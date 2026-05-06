import { describe, it, expect, vi } from "vitest";
import { uploadDashboard } from "./provision";

describe("uploadDashboard", () => {
  it("POSTs to /api/dashboards/db with overwrite:true and Bearer SA token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ status: "success", uid: "nojv-judge-latency", url: "/d/nojv-judge-latency/..." }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await uploadDashboard(
      { stackUrl: "https://x.grafana.net", saToken: "glsa_test" },
      { uid: "nojv-judge-latency", title: "T", schemaVersion: 39, panels: [] },
      fetchMock,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://x.grafana.net/api/dashboards/db",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer glsa_test",
          "Content-Type": "application/json",
        }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.overwrite).toBe(true);
    expect(body.dashboard.uid).toBe("nojv-judge-latency");
    expect(result).toEqual({ uid: "nojv-judge-latency", url: "/d/nojv-judge-latency/..." });
  });

  it("throws with body excerpt on non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("auth failed", { status: 401 }));

    await expect(
      uploadDashboard(
        { stackUrl: "https://x.grafana.net", saToken: "bad" },
        { uid: "x", title: "x", schemaVersion: 39, panels: [] },
        fetchMock,
      ),
    ).rejects.toThrow(/401/);
  });
});
