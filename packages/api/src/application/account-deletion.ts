import { RequestContext } from "@pcobooster/api/application/context";
import type { ApplicationFault } from "@pcobooster/api/application/errors";
import { resolveDemoSession } from "@pcobooster/api/auth/demo-access";
import { moduleLog } from "@pcobooster/api/logging";
import { deleteAccountData } from "@pcobooster/api/modules/account-deletion/delete-account-data";
import type { DeletedAccountData } from "@pcobooster/api/modules/account-deletion/delete-account-data";
import { Server } from "@pcobooster/api/server";
import type { ServerDependencies } from "@pcobooster/api/server";
import { Forbidden } from "@pcobooster/contracts/faults/forbidden";
import { PersistenceFailure } from "@pcobooster/contracts/faults/persistence-failure";
import { Unauthenticated } from "@pcobooster/contracts/faults/unauthenticated";
import { Effect } from "effect";

const accountDeletionLog = moduleLog("account-deletion");

/** Who is asking. Only a real signed-in user can delete, and only themselves. */
export type AccountDeletionCaller =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "demo" }
  /** Local `bun run dev`: every request is the personal access token's owner. */
  | { readonly kind: "development" };

export interface AccountDeletionDependencies {
  readonly identify: (
    request: Request
  ) => Promise<AccountDeletionCaller | null>;
  readonly deleteAccountData: (userId: string) => Promise<DeletedAccountData>;
}

export const createAccountDeletionDependencies = ({
  auth,
  config,
  database,
}: ServerDependencies): AccountDeletionDependencies => ({
  identify: async (request) => {
    // A demo credential wins over a session, as it does for every other procedure.
    if (resolveDemoSession(request, config.demo) !== null) {
      return { kind: "demo" };
    }
    if (config.devAuthBypass) {
      return { kind: "development" };
    }
    // Read the session from D1, never the signed cookie cache: a session revoked elsewhere
    // must not delete anything.
    const found = await auth.api.getSession({
      headers: request.headers,
      query: { disableCookieCache: true },
    });
    return found === null ? null : { kind: "user", userId: found.user.id };
  },
  deleteAccountData: async (userId) =>
    await deleteAccountData(database, userId, new Date()),
});

const persistenceFailure = (operation: string) => (cause: unknown) =>
  new PersistenceFailure({
    detail: "Could not delete the account.",
    operation,
    cause,
  });

/**
 * Deletes the caller's own pcobooster.com account. The user comes from the request's session;
 * there is no input naming one. Resolves with the deleted user's id, for the response cookies.
 */
export const deleteOwnAccount = (
  overrides?: AccountDeletionDependencies
): Effect.Effect<
  { readonly userId: string },
  ApplicationFault,
  RequestContext | Server
> =>
  Effect.gen(function* deleteAccount() {
    const { request } = yield* RequestContext;
    const dependencies =
      overrides ?? createAccountDeletionDependencies(yield* Server);
    const caller = yield* Effect.tryPromise({
      try: async () => await dependencies.identify(request),
      catch: persistenceFailure("identify-account-owner"),
    });
    if (caller === null) {
      return yield* Effect.fail(
        new Unauthenticated({ message: "Sign in required" })
      );
    }
    if (caller.kind === "demo") {
      return yield* Effect.fail(
        new Forbidden({
          message: "The read-only demo has no account to delete.",
        })
      );
    }
    if (caller.kind === "development") {
      return yield* Effect.fail(
        new Forbidden({
          message: "The local API's sign-in has no account to delete.",
        })
      );
    }
    const deleted = yield* Effect.tryPromise({
      try: async () => await dependencies.deleteAccountData(caller.userId),
      catch: persistenceFailure("delete-account-data"),
    });
    // Counts only: the person asked to be forgotten, so their id stays out of the logs.
    yield* accountDeletionLog.info("Account deleted", {
      userDeleted: deleted.userDeleted,
      sessions: deleted.sessions,
      accounts: deleted.accounts,
      feedback: deleted.feedback,
      activityEvents: deleted.activityEvents,
      analyticsErasureQueued: deleted.analyticsErasureQueued,
    });
    return { userId: caller.userId };
  });
