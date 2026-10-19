import { RequestContext } from "@pcobooster/api/application/context";
import type { ApplicationFault } from "@pcobooster/api/application/errors";
import { planningCenterServicesContext } from "@pcobooster/api/application/planning-center/services";
import type { PlanningCenterServices } from "@pcobooster/api/application/planning-center/services";
import { resolveDemoSession } from "@pcobooster/api/auth/demo-access";
import { requirePlanningCenterAccessToken } from "@pcobooster/api/auth/planning-center-session";
import { PlanningCenterApiError } from "@pcobooster/api/planning-center/api-error";
import {
  isPlanningCenterError,
  listedErrorDetails,
  listedValidationErrors,
} from "@pcobooster/api/planning-center/core-client";
import type {
  PlanningCenterError,
  PlanningCenterPersonalAccessToken,
} from "@pcobooster/api/planning-center/core-client";
import {
  createPlanningCenterServices,
  createBasicPlanningCenterServices,
  createReadOnlyPlanningCenterServices,
} from "@pcobooster/api/planning-center/services/factory";
import { Server } from "@pcobooster/api/server";
import type { ServerDependencies } from "@pcobooster/api/server";
import { ExternalServiceFailure } from "@pcobooster/contracts/faults/external-service-failure";
import { Forbidden } from "@pcobooster/contracts/faults/forbidden";
import { InvalidInput } from "@pcobooster/contracts/faults/invalid-input";
import { NotFound } from "@pcobooster/contracts/faults/not-found";
import { RateLimited } from "@pcobooster/contracts/faults/rate-limited";
import { Unauthenticated } from "@pcobooster/contracts/faults/unauthenticated";
import {
  getPresentationSeed,
  isPresentationMode,
} from "@pcobooster/presentation-mode";
import { Context, Effect } from "effect";
import * as HttpClient from "effect/http/HttpClient";

/** A signed-in user acting through their linked Planning Center account. */
export interface AccountAuthentication {
  readonly kind: "account";
  readonly userId: string;
  readonly accessToken: string;
  readonly scopes: readonly string[];
  readonly accountId: string;
  readonly account: {
    readonly id: string;
    readonly accountId: string;
  };
}

/** An anonymous visitor reading the demo organization. */
export interface DemoAuthentication {
  readonly kind: "demo";
  readonly planningCenter: PlanningCenterPersonalAccessToken;
}

export type RequestAuthentication = AccountAuthentication | DemoAuthentication;

export type RequestPlanningCenterServices = ReturnType<
  typeof createPlanningCenterServices
>;

export interface PlanningCenterRequestAccess {
  readonly authentication: RequestAuthentication;
  readonly cacheScope: string;
  readonly services: RequestPlanningCenterServices;
  /** Replace people's personal details with stable fictional ones. */
  readonly presentation: boolean;
  /** Seeds the fictional names; stable so aliases survive restarts. */
  readonly presentationSeed: string;
}

export class PlanningCenterAccess extends Context.Service<
  PlanningCenterAccess,
  PlanningCenterRequestAccess
>()("@pcobooster/api/PlanningCenterAccess") {}

export interface PlanningCenterAccessDependencies {
  readonly authorize: (request: Request) => Promise<RequestAuthentication>;
  readonly createServices: (
    authentication: RequestAuthentication,
    httpClient: HttpClient.HttpClient
  ) => RequestPlanningCenterServices;
  /** Local presentation mode; demo sessions are always presented. */
  readonly presentationMode: () => boolean;
  readonly presentationSeed: string;
}

export const createPlanningCenterAccessDependencies = (
  server: ServerDependencies
): PlanningCenterAccessDependencies => ({
  authorize: async (request) => {
    const demo = resolveDemoSession(request, server.config.demo);
    if (demo) {
      return { kind: "demo", planningCenter: demo.planningCenter };
    }
    const authenticated = await requirePlanningCenterAccessToken(
      server,
      request
    );
    return {
      kind: "account",
      userId: authenticated.session.user.id,
      accessToken: authenticated.accessToken,
      scopes: authenticated.scopes,
      accountId: authenticated.accountId,
      account: authenticated.account,
    };
  },
  createServices: (authentication, httpClient) => {
    const { fallbackTimeZone, localPlanningCenterToken } = server.config;
    const readCaches = server.planningCenterReadCaches;
    if (authentication.kind === "demo") {
      return createReadOnlyPlanningCenterServices(
        authentication.planningCenter,
        fallbackTimeZone,
        httpClient,
        readCaches
      );
    }
    if (server.config.devAuthBypass) {
      if (localPlanningCenterToken === null) {
        throw new Error(
          "DEV_AUTH_BYPASS needs PLANNING_CENTER_CLIENT and PLANNING_CENTER_PAT"
        );
      }
      const createServices = server.config.planningCenterReadOnly
        ? createReadOnlyPlanningCenterServices
        : createBasicPlanningCenterServices;
      return createServices(
        localPlanningCenterToken,
        fallbackTimeZone,
        httpClient,
        readCaches
      );
    }
    return createPlanningCenterServices(
      authentication.accessToken,
      fallbackTimeZone,
      httpClient,
      readCaches,
      server.config.planningCenterReadOnly
    );
  },
  presentationMode: () => isPresentationMode(server.config.presentation),
  presentationSeed: getPresentationSeed(server.config.presentation),
});

const PLANNING_CENTER_FORBIDDEN_STATUS = 403;
const PLANNING_CENTER_NOT_FOUND_STATUS = 404;
const PLANNING_CENTER_UNAUTHORIZED_STATUS = 401;
const PLANNING_CENTER_VALIDATION_STATUS = 422;
/** Planning Center's rate window; a caller that waits this long starts a fresh one. */
const PLANNING_CENTER_RATE_WINDOW_SECONDS = 20;
/** Planning Center's code for a person with no access to the product they called. */
const PLANNING_CENTER_NO_APP_ACCESS_CODE = "TRASH_PANDA";
const PERMISSION_DENIED_MESSAGE =
  "Your Planning Center permissions don't allow this. A Planning Center admin can give you more access.";
const NO_APP_ACCESS_MESSAGE =
  "Your Planning Center account doesn't have access to this Planning Center app. A Planning Center admin can add it.";

/** Planning Center's own reason for rejecting a change, written for people. */
const rejectedChangeMessage = (error: PlanningCenterApiError): string => {
  const details = listedErrorDetails(error.details);
  return details.length > 0
    ? `Planning Center didn't accept that change: ${details.join("; ")}`
    : "Planning Center didn't accept that change.";
};

/**
 * The fault reported for each expected Planning Center failure. Tokens act with the person's
 * own permissions, so a denial is theirs to fix with an admin, not a service failure.
 */
export const planningCenterFault = (
  error: PlanningCenterError
): ApplicationFault => {
  switch (error._tag) {
    case "PlanningCenterReadOnlyError": {
      return new Forbidden({
        message:
          "This Planning Center connection is read-only, so changes aren't saved.",
      });
    }
    case "PlanningCenterApiError": {
      if (error.status === 429) {
        return new RateLimited({
          message:
            "Planning Center rate limit exceeded. Please wait and try again.",
          service: "planning-center",
          retryAfterSeconds: error.retryAfterSeconds,
        });
      }
      if (error.status === PLANNING_CENTER_FORBIDDEN_STATUS) {
        return new Forbidden({ message: PERMISSION_DENIED_MESSAGE });
      }
      if (
        error.status === PLANNING_CENTER_UNAUTHORIZED_STATUS &&
        error.code === PLANNING_CENTER_NO_APP_ACCESS_CODE
      ) {
        return new Forbidden({ message: NO_APP_ACCESS_MESSAGE });
      }
      if (error.status === PLANNING_CENTER_VALIDATION_STATUS) {
        const message = rejectedChangeMessage(error);
        if (error.isWrite === true) {
          return new InvalidInput({
            message,
            providerRejection: {
              errors: listedValidationErrors(
                error.details,
                error.sentAttributeNames ?? []
              ),
            },
          });
        }
        return new InvalidInput({ message });
      }
      return new ExternalServiceFailure({
        message: "Planning Center request failed.",
        service: "planning-center",
        cause: error,
      });
    }
    case "PlanningCenterRateLimitError": {
      return new RateLimited({
        message:
          "Planning Center rate limit exceeded. Please wait and try again.",
        service: "planning-center",
        retryAfterSeconds: error.retryAfterSeconds,
      });
    }
    case "PlanningCenterSubrequestLimitError": {
      if (error.source === "budget" && (error.rateLimitedResponses ?? 0) > 0) {
        return new RateLimited({
          message:
            "Planning Center rate limit exceeded. Please wait and try again.",
          service: "planning-center",
          retryAfterSeconds: PLANNING_CENTER_RATE_WINDOW_SECONDS,
        });
      }
      return new ExternalServiceFailure({
        message:
          "This request needed more Planning Center calls than one request allows.",
        service: "planning-center",
        cause: error,
      });
    }
    case "PlanningCenterNetworkError": {
      return new ExternalServiceFailure({
        message: "Planning Center request failed.",
        service: "planning-center",
        cause: error,
      });
    }
    case "PlanningCenterPaginationError": {
      return new ExternalServiceFailure({
        message: "Planning Center returned more than one request can read.",
        service: "planning-center",
        cause: error,
      });
    }
    default: {
      const exhaustiveError: never = error;
      return exhaustiveError;
    }
  }
};

const toFault = (
  error: PlanningCenterError | ApplicationFault
): ApplicationFault =>
  isPlanningCenterError(error) ? planningCenterFault(error) : error;

/**
 * Reports Planning Center refusing the account (403) as `Forbidden` with a message written
 * for the person, such as which permission they lack; other failures pass through.
 */
export const explainPlanningCenterDenial =
  (message: string) =>
  <Value, Failure, Requirements>(
    effect: Effect.Effect<Value, Failure, Requirements>
  ): Effect.Effect<Value, Failure | Forbidden, Requirements> =>
    Effect.mapError(effect, (failure) =>
      failure instanceof PlanningCenterApiError &&
      failure.status === PLANNING_CENTER_FORBIDDEN_STATUS
        ? new Forbidden({ message })
        : failure
    );

/**
 * Reports a person Planning Center Services has no record of (a 404 on their own Services
 * person, schedules, or plan people) as `NotFound`: they are in People only, on no Services team
 * or schedule yet. Only for reads whose other requests recover their own 404s.
 */
export const explainMissingServicesPerson = <Value, Failure, Requirements>(
  effect: Effect.Effect<Value, Failure, Requirements>
): Effect.Effect<Value, Failure | NotFound, Requirements> =>
  Effect.mapError(effect, (failure) =>
    failure instanceof PlanningCenterApiError &&
    failure.status === PLANNING_CENTER_NOT_FOUND_STATUS
      ? new NotFound({
          resource: "services-person",
          message: "This person isn't in Planning Center Services yet.",
        })
      : failure
  );

/** Reports Planning Center failures as application faults; defects stay defects. */
export const withPlanningCenterFaults = <Value, Requirements>(
  effect: Effect.Effect<
    Value,
    PlanningCenterError | ApplicationFault,
    Requirements
  >
): Effect.Effect<Value, ApplicationFault, Requirements> =>
  Effect.mapError(effect, toFault);

/** Classifies an authorization rejection; anything unexpected is a defect. */
export const toApplicationFault = (error: Error): ApplicationFault | null => {
  if (
    error instanceof Unauthenticated ||
    error instanceof Forbidden ||
    error instanceof InvalidInput
  ) {
    return error;
  }
  return isPlanningCenterError(error) ? planningCenterFault(error) : null;
};

const failAuthorization = (
  error: Error
): Effect.Effect<never, ApplicationFault> => {
  const fault = toApplicationFault(error);
  return fault === null ? Effect.die(error) : Effect.fail(fault);
};

/**
 * Resolves the demo session or Better Auth account and creates clients for
 * this Effect only. Each client retains its credential for its entire lifetime.
 */
export const resolvePlanningCenterAccess = (
  overrides?: PlanningCenterAccessDependencies
): Effect.Effect<
  PlanningCenterRequestAccess,
  ApplicationFault,
  RequestContext | Server | HttpClient.HttpClient
> =>
  Effect.gen(function* resolveAccess() {
    const { request } = yield* RequestContext;
    const dependencies =
      overrides ?? createPlanningCenterAccessDependencies(yield* Server);
    const authentication = yield* Effect.tryPromise({
      try: async () => await dependencies.authorize(request),
      catch: (error) =>
        error instanceof Error
          ? error
          : new Error("Planning Center authorization failed", { cause: error }),
    }).pipe(Effect.catch(failAuthorization));
    const httpClient = yield* HttpClient.HttpClient;
    const services = yield* Effect.sync(() =>
      dependencies.createServices(authentication, httpClient)
    );

    return {
      authentication,
      cacheScope: services.core.getCacheScope(),
      services,
      presentation:
        authentication.kind === "demo" || dependencies.presentationMode(),
      presentationSeed: dependencies.presentationSeed,
    };
  });

/** The request's Planning Center access and each capability bound to its credential. */
export type PlanningCenterRequest =
  | PlanningCenterAccess
  | PlanningCenterServices;

/** `Requirements` once `provideAccess` has supplied the request. */
type WithoutPlanningCenterRequest<Requirements> = Exclude<
  Exclude<Requirements, PlanningCenterServices>,
  PlanningCenterAccess
>;

/** Gives `program` one resolved access: its credential and every capability bound to it. */
export const provideAccess = <Value, Failure, Requirements>(
  program: Effect.Effect<Value, Failure, Requirements>,
  access: PlanningCenterRequestAccess
): Effect.Effect<Value, Failure, WithoutPlanningCenterRequest<Requirements>> =>
  program.pipe(
    Effect.provideContext(planningCenterServicesContext(access.services)),
    Effect.provideService(PlanningCenterAccess, access)
  );

export const withPlanningCenterAccess = <Value, Failure, Requirements>(
  program: Effect.Effect<Value, Failure, Requirements>,
  dependencies?: PlanningCenterAccessDependencies
): Effect.Effect<
  Value,
  Failure | ApplicationFault,
  | WithoutPlanningCenterRequest<Requirements>
  | RequestContext
  | Server
  | HttpClient.HttpClient
> =>
  Effect.acquireUseRelease(
    resolvePlanningCenterAccess(dependencies),
    (access) => provideAccess(program, access),
    // Shared read-cache writes must finish inside the request that started them.
    (access) => access.services.settleReadCaches
  );
