import { causeError } from "@pcobooster/api/http/outcome";
import type { ReportProcedureFailure } from "@pcobooster/api/http/outcome";
/** Where the API Worker reports failures: PostHog, in production only. */
import { moduleLog } from "@pcobooster/api/logging";
import { createPostHogExceptionReporter } from "@pcobooster/api/modules/analytics/posthog-exception";
import { Effect } from "effect";

const reportLog = moduleLog("rpc");

/** Sends reportable outcomes; null where the stage has no project (all but production). */
export const postHogProcedureReporter = (
  apiKey: string | null
): ReportProcedureFailure | null => {
  const report = createPostHogExceptionReporter({
    apiKey,
    fetch: globalThis.fetch,
  });
  if (report === null) {
    return null;
  }
  return ({ fields, error }) =>
    Effect.tryPromise(async () => {
      await report({
        error,
        code: fields.code ?? "UNHANDLED",
        path: fields.route ?? "unknown",
        method: fields.method ?? "unknown",
        requestId: fields.requestId,
        procedure: fields.procedure,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        reportLog.error(
          "Failed to report exception to PostHog",
          { procedure: fields.procedure, requestId: fields.requestId },
          causeError(cause)
        )
      )
    );
};
