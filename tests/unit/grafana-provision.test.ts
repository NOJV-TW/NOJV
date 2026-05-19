import { describe, it, expect, vi } from "vitest";
import {
  buildAlertRule,
  buildContactPoint,
  buildNotificationPolicy,
  uploadAlertRule,
  uploadContactPoint,
  uploadDashboard,
  uploadNotificationPolicy,
  type AlertRuleDef,
} from "../../infra/grafana/provision";

describe("uploadDashboard", () => {
  it("POSTs to /api/dashboards/db with overwrite:true and Bearer SA token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          uid: "nojv-judge-latency",
          url: "/d/nojv-judge-latency/...",
        }),
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

const sampleDef: AlertRuleDef = {
  uid: "nojv-slo-test",
  title: "Test SLO",
  slo: "Test - p95 < 1s",
  expr: "histogram_quantile(0.95, x)",
  threshold: 1,
  for: "10m",
  severity: "warning",
  summary: "test summary",
};

describe("buildAlertRule", () => {
  it("expands a def into the A->B->C Grafana payload", () => {
    const rule = buildAlertRule(sampleDef, { folderUID: "f1", datasourceUid: "ds1" });

    expect(rule.uid).toBe("nojv-slo-test");
    expect(rule.condition).toBe("C");
    expect(rule.folderUID).toBe("f1");
    expect(rule.for).toBe("10m");
    expect(rule.labels.severity).toBe("warning");
    expect(rule.annotations.summary).toBe("test summary");
    expect(rule.data.map((d) => d.refId)).toEqual(["A", "B", "C"]);
    expect(rule.data[0]?.datasourceUid).toBe("ds1");

    const modelA = rule.data[0]?.model as { expr: string };
    expect(modelA.expr).toBe("histogram_quantile(0.95, x)");
    const modelC = rule.data[2]?.model as {
      conditions: { evaluator: { params: number[] } }[];
    };
    expect(modelC.conditions[0]?.evaluator.params).toEqual([1]);
  });
});

describe("uploadAlertRule", () => {
  it("PUTs to the provisioning endpoint by UID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const rule = buildAlertRule(sampleDef, { folderUID: "f1", datasourceUid: "ds1" });

    await uploadAlertRule(
      { stackUrl: "https://x.grafana.net", saToken: "glsa_t" },
      rule,
      fetchMock,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://x.grafana.net/api/v1/provisioning/alert-rules/nojv-slo-test",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          Authorization: "Bearer glsa_t",
          "X-Disable-Provenance": "true",
        }),
      }),
    );
  });

  it("falls back to POST when the rule does not exist yet (404)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const rule = buildAlertRule(sampleDef, { folderUID: "f1", datasourceUid: "ds1" });

    const uid = await uploadAlertRule(
      { stackUrl: "https://x.grafana.net", saToken: "glsa_t" },
      rule,
      fetchMock,
    );

    expect(uid).toBe("nojv-slo-test");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://x.grafana.net/api/v1/provisioning/alert-rules",
    );
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("POST");
  });

  it("throws with a body excerpt on a non-2xx non-404 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("server boom", { status: 500 }));
    const rule = buildAlertRule(sampleDef, { folderUID: "f1", datasourceUid: "ds1" });

    await expect(
      uploadAlertRule(
        { stackUrl: "https://x.grafana.net", saToken: "glsa_t" },
        rule,
        fetchMock,
      ),
    ).rejects.toThrow(/500/);
  });
});

describe("buildContactPoint / buildNotificationPolicy", () => {
  it("builds an email contact point from the address", () => {
    const cp = buildContactPoint("ops@example.com");
    expect(cp.uid).toBe("nojv-slo-contact");
    expect(cp.type).toBe("email");
    expect(cp.settings.addresses).toBe("ops@example.com");
  });

  it("routes the team=nojv label to the NOJV contact point", () => {
    const policy = buildNotificationPolicy();
    expect(policy.receiver).toBe("NOJV SLO Alerts");
    expect(policy.routes[0]?.receiver).toBe("NOJV SLO Alerts");
    expect(policy.routes[0]?.object_matchers).toEqual([["team", "=", "nojv"]]);
  });
});

describe("uploadContactPoint", () => {
  it("PUTs the contact point by UID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 202 }));

    await uploadContactPoint(
      { stackUrl: "https://x.grafana.net", saToken: "glsa_t" },
      buildContactPoint("a@b.c"),
      fetchMock,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://x.grafana.net/api/v1/provisioning/contact-points/nojv-slo-contact",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("falls back to POST on a 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nf", { status: 404 }))
      .mockResolvedValueOnce(new Response("{}", { status: 202 }));

    await uploadContactPoint(
      { stackUrl: "https://x.grafana.net", saToken: "glsa_t" },
      buildContactPoint("a@b.c"),
      fetchMock,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("POST");
  });
});

describe("uploadNotificationPolicy", () => {
  it("PUTs the policy tree to the provisioning endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 202 }));

    await uploadNotificationPolicy(
      { stackUrl: "https://x.grafana.net", saToken: "glsa_t" },
      buildNotificationPolicy(),
      fetchMock,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://x.grafana.net/api/v1/provisioning/policies",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("throws on a non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));

    await expect(
      uploadNotificationPolicy(
        { stackUrl: "https://x.grafana.net", saToken: "glsa_t" },
        buildNotificationPolicy(),
        fetchMock,
      ),
    ).rejects.toThrow(/500/);
  });
});
