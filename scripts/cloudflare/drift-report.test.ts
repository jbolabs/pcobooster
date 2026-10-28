import { describe, expect, it } from "vitest";

import { differingFields, driftReport } from "./drift-report";

const resource = (fqn: string, status: "in-sync" | "drifted" | "missing") => ({
  fqn,
  logicalId: fqn,
  resourceType: "Cloudflare.Worker",
  status,
});

describe(driftReport, () => {
  it("passes when every resource is in sync", () => {
    const report = driftReport("alchemy.run.ts", "prod", [
      resource("Api", "in-sync"),
      resource("Web", "in-sync"),
    ]);
    expect(report.drifted).toBeFalsy();
    expect(report.markdown).toContain("All 2 resources match");
  });

  it("lists drifted and missing resources in name order", () => {
    const report = driftReport("alchemy.run.ts", "prod", [
      resource("Web", "drifted"),
      resource("Api", "in-sync"),
      resource("Database", "missing"),
    ]);
    expect(report.drifted).toBeTruthy();
    expect(report.markdown).toContain("2 of 3 resources differ");
    expect(report.markdown.indexOf("`Database`")).toBeLessThan(
      report.markdown.indexOf("`Web`")
    );
    expect(report.markdown).not.toContain("`Api`");
  });
});

describe(differingFields, () => {
  it("names the nested paths that differ, never their values", () => {
    const fields = differingFields(
      {
        compatibility: { date: "2026-09-01", flags: ["nodejs_compat"] },
        observability: { enabled: true, logs: { invocationLogs: true } },
        name: "pcobooster-prod-web",
      },
      {
        compatibility: { date: "2026-09-01", flags: [] },
        observability: { enabled: true, logs: { invocationLogs: false } },
        name: "pcobooster-prod-web",
        tags: ["dashboard"],
      }
    );
    expect(fields).toStrictEqual([
      "compatibility.flags",
      "observability.logs.invocationLogs",
      "tags",
    ]);
  });

  it("lists a drifted resource's fields in its row", () => {
    const report = driftReport(
      "alchemy.run.ts",
      "prod",
      [resource("Web", "drifted")],
      new Map([["Web", ["compatibility.flags", "tags"]]])
    );
    expect(report.markdown).toContain(
      "| `Web` | Cloudflare.Worker | drifted | `compatibility.flags`, `tags` |"
    );
  });
});
