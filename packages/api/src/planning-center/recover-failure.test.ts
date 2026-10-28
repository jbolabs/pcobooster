import { PlanningCenterApiError } from "@pcobooster/api/planning-center/api-error";
import { PlanningCenterNetworkError } from "@pcobooster/api/planning-center/network-error";
import { PlanningCenterReadOnlyError } from "@pcobooster/api/planning-center/read-only-error";
import {
  isRecoverablePlanningCenterCause,
  recoverPlanningCenterFailure,
  withPlanningCenterFailureDiagnostics,
} from "@pcobooster/api/planning-center/recover-failure";
import type { RecoverablePlanningCenterFailure } from "@pcobooster/api/planning-center/recover-failure";
import { PlanningCenterSubrequestLimitError } from "@pcobooster/api/planning-center/subrequest-limit-error";
import { planningCenterBudgetFailures } from "@pcobooster/api/testing/planning-center-failures";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

const ALL_KINDS: readonly RecoverablePlanningCenterFailure[] = [
  "not-found",
  "permission-denied",
  "provider-failure",
  "unusable-response",
];

const recoverTo =
  (kinds: readonly RecoverablePlanningCenterFailure[]) =>
  async <Failure>(self: Effect.Effect<string, Failure>) =>
    await Effect.runPromiseExit(
      self.pipe(
        recoverPlanningCenterFailure({
          kinds,
          reason: "test fallback",
          fallback: () => "fallback",
        })
      )
    );

const budgetFailures = planningCenterBudgetFailures();

describe(recoverPlanningCenterFailure, () => {
  it.each(budgetFailures)(
    "propagates %s even when every kind is listed",
    async (failure) => {
      const exit = await recoverTo(ALL_KINDS)(Effect.fail(failure));

      expect(exit).toStrictEqual(Exit.fail(failure));
    }
  );

  it("propagates a budget failure alongside a recoverable one", async () => {
    const limit = new PlanningCenterSubrequestLimitError({
      source: "worker",
      requests: 50,
    });
    const cause = Cause.combine(
      Cause.fail(
        new PlanningCenterApiError({ message: "Not found", status: 404 })
      ),
      Cause.fail(limit)
    );
    const exit = await recoverTo(ALL_KINDS)(Effect.failCause(cause));

    expect(exit).toStrictEqual(Exit.failCause(cause));
  });

  it("propagates interruption", async () => {
    const exit = await recoverTo(ALL_KINDS)(Effect.interrupt);

    expect(
      Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
    ).toBeTruthy();
  });

  it("propagates read-only rejections", async () => {
    const error = new PlanningCenterReadOnlyError({
      method: "POST",
      path: "/services/v2/plans",
    });
    const exit = await recoverTo(ALL_KINDS)(Effect.fail(error));

    expect(exit).toStrictEqual(Exit.fail(error));
  });

  it("falls back after a listed 404", async () => {
    const exit = await recoverTo(["not-found"])(
      Effect.fail(
        new PlanningCenterApiError({ message: "Not found", status: 404 })
      )
    );

    expect(exit).toStrictEqual(Exit.succeed("fallback"));
  });

  it("propagates a provider failure that is not listed", async () => {
    const error = new PlanningCenterApiError({
      message: "Server error",
      status: 500,
    });
    const exit = await recoverTo(["not-found"])(Effect.fail(error));

    expect(exit).toStrictEqual(Exit.fail(error));
  });

  it("falls back after a network failure when provider failures are listed", async () => {
    const exit = await recoverTo(["provider-failure"])(
      Effect.fail(new PlanningCenterNetworkError({ cause: new Error("down") }))
    );

    expect(exit).toStrictEqual(Exit.succeed("fallback"));
  });

  it.each([
    { status: 403, code: undefined },
    { status: 401, code: "TRASH_PANDA" },
  ])(
    "falls back after a listed permission denial ($status)",
    async ({ status, code }) => {
      const exit = await recoverTo(["permission-denied"])(
        Effect.fail(
          new PlanningCenterApiError({ message: "Denied", status, code })
        )
      );

      expect(exit).toStrictEqual(Exit.succeed("fallback"));
    }
  );

  it("keeps recovering permission denials where provider failures are listed", async () => {
    const exit = await recoverTo(["provider-failure"])(
      Effect.fail(
        new PlanningCenterApiError({ message: "Denied", status: 403 })
      )
    );

    expect(exit).toStrictEqual(Exit.succeed("fallback"));
  });

  it("propagates a rejected token even when permission denials are listed", async () => {
    const error = new PlanningCenterApiError({
      message: "Unauthorized",
      status: 401,
    });
    const exit = await recoverTo(["permission-denied"])(Effect.fail(error));

    expect(exit).toStrictEqual(Exit.fail(error));
  });

  it("propagates a server error when only permission denials are listed", async () => {
    const error = new PlanningCenterApiError({ message: "Down", status: 503 });
    const exit = await recoverTo(["permission-denied"])(Effect.fail(error));

    expect(exit).toStrictEqual(Exit.fail(error));
  });

  it("recovers a defect only when unusable responses are listed", async () => {
    const defect = Effect.die(new Error("empty response"));

    await expect(
      recoverTo(["unusable-response"])(defect)
    ).resolves.toStrictEqual(Exit.succeed("fallback"));
    const unlisted = await recoverTo(["not-found", "provider-failure"])(defect);
    expect(
      Exit.isFailure(unlisted) && Cause.hasDies(unlisted.cause)
    ).toBeTruthy();
  });
});

describe(isRecoverablePlanningCenterCause, () => {
  it.each(budgetFailures)("never treats %s as recoverable", (failure) => {
    expect(
      isRecoverablePlanningCenterCause(Cause.fail(failure), ALL_KINDS)
    ).toBeFalsy();
  });

  it("accepts a listed provider failure", () => {
    expect(
      isRecoverablePlanningCenterCause(
        Cause.fail(new PlanningCenterApiError({ message: "Bad", status: 502 })),
        ["provider-failure"]
      )
    ).toBeTruthy();
  });
});

describe(withPlanningCenterFailureDiagnostics, () => {
  it.each(budgetFailures)(
    "keeps an original rejection when diagnostics encounter %s",
    async (diagnosticFailure) => {
      const rejection = new PlanningCenterApiError({
        status: 422,
        message: "Rejected write",
      });
      const exit = await Effect.runPromiseExit(
        Effect.fail(rejection).pipe(
          withPlanningCenterFailureDiagnostics(
            (_failure: PlanningCenterApiError) => Effect.fail(diagnosticFailure)
          )
        )
      );
      expect(exit).toStrictEqual(Exit.fail(rejection));
    }
  );

  it("returns successful product data without running diagnostics", async () => {
    const result = await Effect.runPromise(
      Effect.succeed("saved item").pipe(
        withPlanningCenterFailureDiagnostics(() =>
          Effect.die(new Error("Must not diagnose a successful write"))
        )
      )
    );
    expect(result).toBe("saved item");
  });
});
