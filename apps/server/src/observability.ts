import * as Cloudflare from "alchemy/Cloudflare";

import type { StageSettings } from "./stage";

/**
 * Share of production invocations that record a trace. Traces count against the same Workers
 * event allowance as logs, and one traced request records a span for every
 * Planning Center, D1, and KV subrequest, so production samples while staging and previews,
 * whose traffic is only the team's, trace everything.
 */
const productionTraceSamplingRate = 0.2;

const traceSamplingRate = (production: boolean): number =>
  production ? productionTraceSamplingRate : 1;

const workerLogs = { enabled: true, invocationLogs: true };

/**
 * Workers Logs as Alchemy enables them by default, plus Workers Issues and Traces. Traces show each
 * invocation's subrequests, which is how to inspect overhead beside the provider
 * request count (AGENTS.md, Request Budget). For the product Worker.
 */
export const workerObservability = (
  production: boolean
): Cloudflare.Workers.WorkerObservability => ({
  enabled: true,
  logs: workerLogs,
  issues: { enabled: true },
  traces: { enabled: true, headSamplingRate: traceSamplingRate(production) },
});

/** The API Worker's logs; `apiWorkerTelemetry` turns on its traces. */
export const apiWorkerObservability =
  (): Cloudflare.Workers.WorkerObservability => ({
    enabled: true,
    logs: workerLogs,
    issues: { enabled: true },
  });

/**
 * The API Worker's traces, with its Effect spans (`Effect.withSpan`, `Effect.fn`) mirrored into
 * each invocation's waterfall beside the fetch, D1, and KV subrequests Cloudflare records, so
 * a trace shows where a procedure spends its time as well as its subrequests.
 */
export const apiWorkerTelemetry = ({ production }: StageSettings) =>
  Cloudflare.Telemetry({ headSamplingRate: traceSamplingRate(production) });
