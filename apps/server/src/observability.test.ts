import { describe, expect, it } from "vitest";

import { apiWorkerObservability, workerObservability } from "./observability";

describe("Worker observability", () => {
  it("enables API Issues while preserving invocation logs", () => {
    expect(apiWorkerObservability()).toStrictEqual({
      enabled: true,
      logs: { enabled: true, invocationLogs: true },
      issues: { enabled: true },
    });
  });

  it("preserves product trace sampling alongside Issues and logs", () => {
    for (const production of [false, true]) {
      expect(workerObservability(production)).toStrictEqual({
        enabled: true,
        logs: { enabled: true, invocationLogs: true },
        issues: { enabled: true },
        traces: { enabled: true, headSamplingRate: production ? 0.2 : 1 },
      });
    }
  });
});
