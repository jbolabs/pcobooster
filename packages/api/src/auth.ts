import { bearerSessions } from "@pcobooster/api/auth/bearer-sessions";
import { deviceAccounts } from "@pcobooster/api/auth/device-accounts";
import { nativeSignIn } from "@pcobooster/api/auth/native-sign-in";
import {
  getPlanningCenterIdentityFromAccessToken,
  getPlanningCenterRawUserInfo,
} from "@pcobooster/api/auth/planning-center-identity";
import { PLANNING_CENTER_SELECTED_ACCOUNT_COOKIE } from "@pcobooster/api/auth/planning-center-session";
import { createPreviewProxy } from "@pcobooster/api/auth/preview-proxy";
import { parseSignInFailure } from "@pcobooster/api/auth/sign-in-failure";
import type { ServerConfig } from "@pcobooster/api/config/server-config";
import {
  getActivityRequestContext,
  recordActivityEvent,
} from "@pcobooster/api/db/activity-events";
import type { Db } from "@pcobooster/api/db/client";
import * as schema from "@pcobooster/api/db/schema";
import { boundaryLog } from "@pcobooster/api/logging";
import type { PostHogPersonProperties } from "@pcobooster/api/modules/analytics/posthog-capture";
import { getPostHogPersonProperties } from "@pcobooster/api/modules/analytics/posthog-person";
import { upsertPlanningCenterAccountIdentity } from "@pcobooster/api/modules/planning-center/account-identities";
import { PLANNING_CENTER_USER_AGENT } from "@pcobooster/api/planning-center/user-agent";
import type { JsonObject } from "@pcobooster/planning-center-models/json";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { genericOAuth } from "better-auth/plugins/generic-oauth";

const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;
const SELECTED_ACCOUNT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** The part of Better Auth's endpoint context an account hook uses to set a cookie. */
interface AccountHookContext {
  readonly path?: string;
  setCookie: (
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      sameSite: "lax";
      maxAge: number;
      path: string;
      secure: boolean;
    }
  ) => string;
}

const shouldTrackSessionDeletion = (
  context: Parameters<typeof getActivityRequestContext>[0]
): boolean => {
  const requestContext = getActivityRequestContext(context);
  if (!(requestContext.path !== null && requestContext.path !== "")) {
    return false;
  }

  return (
    requestContext.path.includes("/sign-out") ||
    requestContext.path.includes("/revoke-session") ||
    requestContext.path.includes("/revoke-sessions")
  );
};

/** The local product origin as `localhost`, which browsers treat as a different origin. */
const localhostAlias = (origin: string): string => {
  const url = new URL(origin);
  url.hostname = "localhost";
  return url.origin;
};

export const createAuth = (config: ServerConfig, database: Db) => {
  const authEventLog = boundaryLog("auth/events");
  const { planningCenter, previewOriginPattern, proxy } = config.auth;

  const trustedOrigins = [
    ...(previewOriginPattern === null ? [] : [previewOriginPattern]),
    config.publicOrigin,
    ...(config.localDevelopment ? [localhostAlias(config.publicOrigin)] : []),
  ];

  const recordAuthEventSafely = async (
    eventType:
      | "auth_session_created"
      | "auth_session_deleted"
      | "auth_account_linked"
      | "auth_sign_in_failed",
    payload: {
      userId?: string | null;
      accountId?: string | null;
      metadata?: JsonObject;
      errorCode?: string | null;
      person?: PostHogPersonProperties | null;
      context: Parameters<typeof getActivityRequestContext>[0];
    }
  ) => {
    try {
      const requestContext = getActivityRequestContext(payload.context);
      await recordActivityEvent(
        { database, config },
        {
          eventType,
          actorUserId: payload.userId ?? null,
          actorAccountId: payload.accountId ?? null,
          requestId: requestContext.requestId,
          path: requestContext.path,
          method: requestContext.method,
          ipAddress: requestContext.ipAddress,
          userAgent: requestContext.userAgent,
          success:
            payload.errorCode === undefined || payload.errorCode === null,
          statusCode: 200,
          errorCode: payload.errorCode ?? null,
          metadata: payload.metadata ?? null,
        },
        payload.person ?? null
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      authEventLog.warn(
        "Failed to record auth activity event",
        { eventType },
        err
      );
    }
  };

  const getPostHogPersonSafely = async (
    userId: string
  ): Promise<PostHogPersonProperties | null> => {
    try {
      return await getPostHogPersonProperties(userId, database);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      authEventLog.warn("Failed to load PostHog person properties", {}, err);
      return null;
    }
  };

  /**
   * The organization someone signs in with is the one they see, until they sign in with
   * another. A sign-in callback writes that organization's account (linking it or storing new
   * tokens), so it is selected here rather than inferred later from which account changed last.
   */
  const selectSignedInAccount = (
    account: { id: string; providerId: string },
    context: AccountHookContext | null
  ): void => {
    if (
      account.providerId !== "planning-center" ||
      context?.path?.startsWith("/callback/") !== true
    ) {
      return;
    }
    context.setCookie(PLANNING_CENTER_SELECTED_ACCOUNT_COOKIE, account.id, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: SELECTED_ACCOUNT_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      secure: !config.localDevelopment,
    });
  };

  const getPlanningCenterIdentitySafely = async (account: {
    id: string;
    accountId: string;
    accessToken?: string | null;
  }) => {
    try {
      const identity = await getPlanningCenterIdentityFromAccessToken(
        account.accessToken
      );
      if (identity) {
        await upsertPlanningCenterAccountIdentity(
          {
            accountId: account.id,
            providerAccountId: account.accountId,
            identity,
          },
          database
        );
      }
      return identity;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      authEventLog.warn(
        "Failed to record Planning Center account identity",
        { accountId: account.id },
        err
      );
      return null;
    }
  };

  return betterAuth({
    baseURL: config.publicOrigin,
    secret: config.auth.secret,
    trustedOrigins,
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
      camelCase: true,
      transaction: false,
    }),
    session: {
      // Most requests check the session; a short-lived signed copy in a cookie saves the D1
      // lookup. A revoked session can stay valid on other devices for up to this long.
      cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["planning-center"],
        updateUserInfoOnLink: true,
        // Each Planning Center organization signs in as its own subject with the same email, and
        // its userinfo has no `email_verified` claim, so every user is stored unverified. Planning
        // Center is the only way to create a user here, so the local email is Planning Center's
        // own and linking another organization to it is safe.
        requireLocalEmailVerified: false,
      },
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session, context) => {
            await recordAuthEventSafely("auth_session_created", {
              userId: session.userId,
              person: await getPostHogPersonSafely(session.userId),
              context,
            });
          },
        },
        delete: {
          after: async (session, context) => {
            if (!shouldTrackSessionDeletion(context)) {
              return;
            }

            await recordAuthEventSafely("auth_session_deleted", {
              userId: session.userId,
              metadata: {
                sessionId: session.id,
              },
              context,
            });
          },
        },
      },
      account: {
        create: {
          after: async (account, context) => {
            selectSignedInAccount(account, context);
            if (account.providerId !== "planning-center") {
              return;
            }

            const identity = await getPlanningCenterIdentitySafely(account);
            await recordAuthEventSafely("auth_account_linked", {
              userId: account.userId,
              accountId: account.id,
              metadata: {
                providerId: account.providerId,
                organizationId: identity?.organizationId ?? null,
                organizationName: identity?.organizationName ?? null,
                planningCenterUserId: identity?.sub ?? null,
              },
              context,
            });
          },
        },
        update: {
          after: async (account, context) => {
            // Better Auth types this hook as async; selecting only sets a response cookie.
            await Promise.resolve();
            // Token refreshes also update the account; only a sign-in callback selects it.
            selectSignedInAccount(account, context);
          },
        },
      },
    },
    hooks: {
      // Better Auth reports a failed provider callback only as a `?error=` redirect.
      after: createAuthMiddleware(async (ctx) => {
        if (!ctx.path.startsWith("/callback/")) {
          return;
        }
        const failure = parseSignInFailure(
          ctx.context.responseHeaders?.get("location")
        );
        if (failure === null) {
          return;
        }
        authEventLog.warn("Planning Center sign-in failed", {
          code: failure.code,
          receivedCode: failure.receivedCode,
          description: failure.description,
        });
        await recordAuthEventSafely("auth_sign_in_failed", {
          errorCode: failure.receivedCode,
          metadata: { code: failure.code },
          context: ctx,
        });
      }),
    },
    socialProviders: {},
    plugins: [
      deviceAccounts(database),
      genericOAuth({
        config: [
          {
            providerId: "planning-center",
            discoveryUrl:
              "https://api.planningcenteronline.com/.well-known/openid-configuration",
            // Discovery runs once per server instance. Pinned endpoints keep the
            // provider registered when that fetch fails, instead of every
            // sign-in on the instance returning PROVIDER_NOT_FOUND.
            authorizationUrl:
              "https://api.planningcenteronline.com/oauth/authorize",
            tokenUrl: "https://api.planningcenteronline.com/oauth/token",
            userInfoUrl: "https://api.planningcenteronline.com/oauth/userinfo",
            // Planning Center asks every client to identify itself. Better Auth
            // takes headers for discovery and the code exchange, and a hook for
            // userinfo. Its refresh-token request has no header option.
            discoveryHeaders: { "User-Agent": PLANNING_CENTER_USER_AGENT },
            authorizationHeaders: { "User-Agent": PLANNING_CENTER_USER_AGENT },
            getUserInfo: async (tokens) =>
              await getPlanningCenterRawUserInfo(tokens.accessToken),
            clientId: planningCenter.clientId,
            clientSecret: planningCenter.clientSecret,
            scopes: ["openid", "services", "people"],
            // Force Planning Center to prompt for login so users can switch accounts/org context.
            prompt: "login",
            pkce: true,
            accessType: "offline",
            tokenEndpointAuth: { method: "client_secret_basic" },
            overrideUserInfo: true,
          },
        ],
      }),
      // Native app sign-in: bearer sessions plus the handoff from the Planning Center callback.
      bearerSessions(),
      nativeSignIn(),
      ...(proxy === null
        ? []
        : [
            createPreviewProxy({
              currentURL: config.publicOrigin,
              productionURL: proxy.productionUrl,
              secret: proxy.secret,
              production: config.production,
            }),
          ]),
    ],
  });
};

export type Auth = ReturnType<typeof createAuth>;
