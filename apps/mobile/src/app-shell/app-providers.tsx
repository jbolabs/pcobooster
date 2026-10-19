import {
  readRetryDelay,
  retryTransientReadFailure,
  speculativeQuery,
} from "@pcobooster/client/query";
import { formatAppRelease } from "@pcobooster/contracts/http/request-diagnostics";
import { addEventListener } from "@react-native-community/netinfo";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
  useIsRestoring,
  useQueryClient,
  useQuery,
} from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Effect } from "effect";
import * as Application from "expo-application";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { Alert, AppState, StyleSheet, View } from "react-native";

import { ErrorToastProvider } from "../components/error-toast";
import { colors } from "../design/colors";
import {
  isApiFailureOrCancellation,
  makeApiFailureReporter,
} from "../diagnostics/api-diagnostics";
import { deviceDiagnostics } from "../diagnostics/device-diagnostics";
import { withApiProbe } from "../diagnostics/probe-transport";
import type { ApiProbe } from "../diagnostics/probe-transport";
import { DiagnosticsProbeError, diagnosticsProbe } from "../diagnostics/probes";
import { releaseMetadata } from "../diagnostics/release-metadata";
import { sessionContextFor } from "../diagnostics/session-context";
import { FeedbackDraftProvider } from "../features/account/feedback-draft";
import { clearSongPreviews } from "../features/songs/preview-files";
import {
  launchOptions,
  releaseSmokeNetwork,
} from "../harness/current-launch-options";
import { FIXTURE_ANCHOR_NOW } from "../harness/launch-options";
import {
  ClockProvider,
  FALLBACK_TIME_ZONE,
  OrgTimeZoneProvider,
} from "../lib/environment";
import type { AppClock } from "../lib/environment";
import { useToasts } from "../lib/toasts";
import { AccountDeletedWithLeftoversError } from "../session/account-deleted-with-leftovers";
import {
  appStorage,
  deviceCrypto,
  ephemeralWebAuthentication,
  keychainStorage,
  removeAppStorageKeys,
} from "../session/device-services";
import { SignInFailure } from "../session/native-sign-in";
import { accountDeletionFailureMessage } from "./account-deletion-messages";
import { syncAccountAnalytics } from "./analytics";
import {
  makeFixtureRuntime,
  makeLiveRuntime,
  makeReleaseSmokeRuntime,
} from "./app-runtime";
import type { AppRuntime } from "./app-runtime";
import { makeCacheStorage } from "./cache-storage";
import { deviceAnalytics } from "./device-analytics";
import { receiveDemoKeys } from "./link-inbox";
import { usePreferences, PreferencesProvider } from "./preferences";
import {
  failureMessage,
  ProductClientContext,
  sharedReads,
  useProductClient,
} from "./queries";
import {
  deserializeQueryCache,
  QUERY_CACHE_MAX_AGE_MS,
  queryCacheBuster,
  queryCacheKey,
  serializeQueryCache,
} from "./query-persistence";
import { makeScopedQueryClient } from "./scoped-query-client";
import type { ScopedQueryReporting } from "./scoped-query-client";
import { SessionContext } from "./session";
import type { SessionValue, SignInActivity } from "./session";

const fixedClock: AppClock = { now: () => FIXTURE_ANCHOR_NOW };
const systemClock: AppClock = { now: () => new Date() };
// Smoke builds read the fixtures, so they keep the fixtures' clock.
const appClock =
  launchOptions.fixedNow || releaseSmokeNetwork !== null
    ? fixedClock
    : systemClock;

/** The rocket's launch-away before the app replaces the sign-in screen (Swift `launchAwayDelay`). */
const LAUNCH_AWAY_MS = 450;
/** The account sheet slides away before a switch rebuilds the app (Swift `dismissDelay`). */
export const SHEET_DISMISS_MS = 380;
const PERSIST_THROTTLE_MS = 1000;
const DEFAULT_STALE_MS = 30_000;

const delay = async (ms: number) => {
  await Effect.runPromise(Effect.sleep(ms));
};

const cacheStorage = makeCacheStorage(appStorage, removeAppStorageKeys);

const isApiProbe = (probe: typeof diagnosticsProbe): probe is ApiProbe =>
  probe === "api-5xx" ||
  probe === "api-undecodable" ||
  probe === "api-network" ||
  probe === "api-5xx-transient";

const deviceServices = {
  secrets: keychainStorage,
  appStorage,
  crypto: deviceCrypto,
  authenticate: ephemeralWebAuthentication,
  appRelease: formatAppRelease(releaseMetadata),
  reportOrigin: deviceDiagnostics.origin,
  productFetch: isApiProbe(diagnosticsProbe)
    ? withApiProbe(globalThis.fetch, diagnosticsProbe)
    : globalThis.fetch,
  onForget: async (userIds: readonly string[]) => {
    clearSongPreviews();
    await cacheStorage.forget(userIds);
  },
};

const makeRuntime = (): AppRuntime => {
  if (launchOptions.mock) {
    return makeFixtureRuntime(launchOptions, appClock.now);
  }
  if (releaseSmokeNetwork !== null) {
    return makeReleaseSmokeRuntime(
      launchOptions,
      deviceServices,
      releaseSmokeNetwork,
      appClock.now
    );
  }
  return makeLiveRuntime(launchOptions, deviceServices);
};

/** One runtime per app session. */
const runtime: AppRuntime = makeRuntime();

// Verification build probes (`diagnostics/probes.ts`); `diagnosticsProbe` is null otherwise.
if (diagnosticsProbe === "handled") {
  deviceDiagnostics.captureException(
    new DiagnosticsProbeError("Diagnostics probe: handled"),
    "handled"
  );
}
if (diagnosticsProbe === "rejection") {
  void Promise.reject(
    new DiagnosticsProbeError("Diagnostics probe: rejection")
  );
}

// Error reports follow the session: held while it restores or nobody is signed in, purged on a
// demo, and sent only for a signed-in account (`diagnostics/capture-policy.ts`).
deviceDiagnostics.setSession(
  sessionContextFor(runtime.session.getSnapshot().phase)
);
runtime.session.subscribe(() => {
  deviceDiagnostics.setSession(
    sessionContextFor(runtime.session.getSnapshot().phase)
  );
});

/** One query cache; every key starts with the account scope, so nothing crosses accounts. */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: retryTransientReadFailure,
      retryDelay: readRetryDelay,
      staleTime: DEFAULT_STALE_MS,
      // Kept as long as the disk copy, so a restored read is not collected before it paints.
      gcTime: QUERY_CACHE_MAX_AGE_MS,
    },
  },
});

if (!runtime.isFixtureMode) {
  // Stale reads revalidate when the app comes to the foreground and when the network returns.
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener("change", (state) => {
      setFocused(state === "active");
    });
    return () => {
      subscription.remove();
    };
  });
  onlineManager.setEventListener((setOnline) =>
    addEventListener((state) => {
      setOnline(state.isConnected !== false);
    })
  );
}

const reportApiFailure = makeApiFailureReporter(deviceDiagnostics);
// API failures and cancellations are reported by the query caches alone, never again as
// uncaught errors, unhandled rejections, or render errors.
deviceDiagnostics.setReportedElsewhere(isApiFailureOrCancellation);

const scopedQueryReporting: ScopedQueryReporting = {
  report: reportApiFailure,
  origin: deviceDiagnostics.origin,
  currentScope: () => runtime.session.getSnapshot().scope,
  online: () => onlineManager.isOnline(),
};

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.surfaceCanvas,
  },
});

const RestoredContent = ({ children }: { children: ReactNode }) => {
  const restoring = useIsRestoring();
  return (
    <View style={{ flex: 1 }}>
      {restoring ? <View style={styles.cover} /> : children}
    </View>
  );
};

const ScopedQueries = ({
  scope,
  persisted,
  children,
}: {
  scope: string;
  persisted: boolean;
  children: ReactNode;
}) => {
  const cache = useMemo(
    () =>
      makeScopedQueryClient(
        scope,
        queryClient.getDefaultOptions(),
        scopedQueryReporting
      ),
    [scope]
  );
  const persister = useMemo(
    () =>
      createAsyncStoragePersister({
        storage: cacheStorage.forScope(queryCacheKey(runtime.origin, scope)),
        key: queryCacheKey(runtime.origin, scope),
        throttleTime: PERSIST_THROTTLE_MS,
        serialize: serializeQueryCache,
        deserialize: deserializeQueryCache,
      }),
    [scope]
  );
  if (!persisted) {
    return <QueryClientProvider client={cache}>{children}</QueryClientProvider>;
  }
  return (
    <PersistQueryClientProvider
      client={cache}
      persistOptions={{
        persister,
        buster: queryCacheBuster(
          `${Application.nativeApplicationVersion ?? "0"}(${Application.nativeBuildVersion ?? "0"})`
        ),
        maxAge: QUERY_CACHE_MAX_AGE_MS,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            query.queryKey[0] === scope && query.state.status === "success",
          shouldDehydrateMutation: () => false,
        },
      }}
    >
      <RestoredContent>{children}</RestoredContent>
    </PersistQueryClientProvider>
  );
};

const isSignedInPhase = (kind: string): boolean =>
  kind === "signedIn" || kind === "demo" || kind === "development";

/**
 * Keeps the remembered profile and organization in step with `accounts.list`, and warms the
 * account sheet's permissions read behind whatever the person is waiting on.
 */
const AccountSync = () => {
  useEffect(
    () => () => {
      deviceAnalytics.reset();
    },
    []
  );
  const context = useProductClient();
  const cache = useQueryClient();
  const accounts = useQuery(sharedReads.accounts(context));
  const { analyticsOptedOut } = usePreferences();
  useEffect(() => {
    const phase = runtime.session.getSnapshot().phase.kind;
    const userId =
      phase === "signedIn" && accounts.data !== undefined && !accounts.data.demo
        ? accounts.data.session.userId
        : null;
    void (async () => {
      try {
        await syncAccountAnalytics(deviceAnalytics, analyticsOptedOut, userId);
      } catch {
        /* Analytics does not block product use. */
      }
    })();
  }, [accounts.data, analyticsOptedOut]);
  useEffect(() => {
    if (accounts.data !== undefined) {
      runtime.session.refreshFromAccounts(accounts.data);
    }
  }, [accounts.data]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        await context.scheduler.runSpeculative(async () => {
          await cache.query(speculativeQuery(sharedReads.access(context)));
        }, controller.signal);
      } catch {
        /* A warm-up failure is shown by the account sheet's observed read. */
      }
    })();
    return () => {
      controller.abort();
    };
  }, [cache, context]);
  return null;
};

/**
 * The session: the runtime's store, the sign-in flows, demo links, and the product client and
 * query cache for the current account context.
 */
const SessionProvider = ({ children }: { children: ReactNode }) => {
  const toasts = useToasts();
  const { session, scheduler } = runtime;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [activity, setActivity] = useState<SignInActivity>({ kind: "idle" });
  const activityRef = useRef(activity);

  const [signInMessage, setSignInMessage] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  useEffect(() => {
    void (async () => {
      await runtime.start();
      if (runtime.checksDevelopmentSignIn) {
        await session.checkDevelopmentBypass();
      }
    })();
  }, [session]);

  const { phase, scope } = snapshot;
  const isSignedIn = isSignedInPhase(phase.kind);
  const active =
    phase.kind === "signedIn" || phase.kind === "needsSignIn"
      ? phase.account
      : null;

  const signIn = useCallback<SessionValue["signIn"]>(
    async ({ resuming, addingAccount = false } = {}) => {
      if (activityRef.current.kind !== "idle") {
        return;
      }
      const userId = resuming?.userId ?? null;
      setSignInMessage(null);
      activityRef.current = { kind: "authenticating", userId };
      setActivity(activityRef.current);
      try {
        const result = await runtime.signIn();
        if (!addingAccount) {
          setActivity({ kind: "launching", userId });
          await delay(LAUNCH_AWAY_MS);
        }
        const scopeBefore = session.getSnapshot().scope;
        await session.completeSignIn(result);
        if (session.getSnapshot().scope === scopeBefore) {
          // The same person and organization again: keep the cache, reload what failed.
          void queryClient.invalidateQueries();
        }
      } catch (error) {
        const cancelled =
          error instanceof SignInFailure && error.reason === "cancelled";
        if (!cancelled && error instanceof Error) {
          const message = failureMessage(error);
          if (addingAccount) {
            toasts.showError(message);
          } else {
            setSignInMessage(message);
          }
        }
      }
      activityRef.current = { kind: "idle" };
      setActivity(activityRef.current);
    },
    [session, toasts]
  );

  const continueAs = useCallback(
    (account: SessionValue["accounts"][number]) => {
      if (account.needsSignIn) {
        void signIn({ resuming: account });
        return;
      }
      if (activityRef.current.kind !== "idle") {
        return;
      }
      setSignInMessage(null);
      activityRef.current = { kind: "launching", userId: account.userId };
      setActivity(activityRef.current);
      void (async () => {
        await delay(LAUNCH_AWAY_MS);
        session.switchAccount(account.userId);
        activityRef.current = { kind: "idle" };
        setActivity(activityRef.current);
      })();
    },
    [session, signIn]
  );

  const startDemo = useCallback(
    async (key: string) => {
      await session.startDemo(key);
    },
    [session]
  );

  // Demo links from outside: straight in when signed out, after a question when signed in.
  useEffect(
    () =>
      receiveDemoKeys((key) => {
        const open = async () => {
          try {
            await session.startDemo(key);
          } catch (error) {
            const message =
              error instanceof Error
                ? failureMessage(error)
                : "Something went wrong.";
            if (isSignedInPhase(session.getSnapshot().phase.kind)) {
              toasts.showError(message);
            } else {
              setSignInMessage(message);
            }
          }
        };
        const current = session.getSnapshot().phase.kind;
        if (current === "signedIn" || current === "development") {
          Alert.alert(
            "Open the demo?",
            "You'll explore a read-only demo. Your account stays signed in on this device.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Open Demo",
                onPress: () => {
                  void open();
                },
              },
            ]
          );
          return;
        }
        void open();
      }),
    [session, toasts]
  );

  const value = useMemo<SessionValue>(
    () => ({
      phase,
      accounts: snapshot.stored.accounts,
      active,
      isSignedIn,
      isDemo: phase.kind === "demo",
      isDevelopment: phase.kind === "development",
      signInActivity: activity,
      signInMessage,
      isSigningOut,
      signIn,
      continueAs,
      switchAccount: session.switchAccount,
      forget: async (account) => {
        await session.remove(account.userId);
      },
      isDeletingAccount,
      deleteAccount: async () => {
        setIsDeletingAccount(true);
        let deleted = false;
        try {
          await session.deleteAccount();
          deleted = true;
        } catch (error) {
          // Deleted on the server: say what this device kept, never "couldn't delete".
          deleted = error instanceof AccountDeletedWithLeftoversError;
          toasts.showError(
            error instanceof Error
              ? accountDeletionFailureMessage(error)
              : "Couldn't delete your account."
          );
        }
        setIsDeletingAccount(false);
        return deleted;
      },
      signOut: async () => {
        setIsSigningOut(true);
        try {
          await session.signOut();
        } catch (error) {
          toasts.showError(
            error instanceof Error
              ? failureMessage(error)
              : "Couldn't sign out."
          );
        }
        setIsSigningOut(false);
      },
      switchOrganization: async (accountId) => {
        try {
          await session.switchOrganization(accountId);
        } catch (error) {
          if (error instanceof Error) {
            toasts.showError(failureMessage(error));
          }
        }
      },
      startDemo,
    }),
    [
      active,
      activity,
      continueAs,
      isDeletingAccount,
      isSignedIn,
      isSigningOut,
      phase,
      session,
      signIn,
      signInMessage,
      snapshot.stored.accounts,
      startDemo,
      toasts,
    ]
  );

  const clientContext = useMemo(
    () => ({ client: runtime.clientForScope(scope), scope, scheduler }),
    [scheduler, scope]
  );

  return (
    <SessionContext value={value}>
      <ScopedQueries
        key={scope}
        scope={scope}
        persisted={!runtime.isFixtureMode && isSignedIn && snapshot.persisted}
      >
        <ProductClientContext value={clientContext}>
          {isSignedIn ? <AccountSync /> : null}
          {children}
          {/* Restoring the session or cached reads: the canvas, never a skeleton flash. */}
          {phase.kind === "launching" ? (
            <View pointerEvents="none" style={styles.cover} />
          ) : null}
        </ProductClientContext>
      </ScopedQueries>
    </SessionContext>
  );
};

const useSessionPhase = () => {
  const snapshot = useSyncExternalStore(
    runtime.session.subscribe,
    runtime.session.getSnapshot
  );
  return { isSignedIn: isSignedInPhase(snapshot.phase.kind) };
};

/** The congregation's zone from `catalog.organization` once signed in, else the fallback. */
const OrganizationTimeZone = ({ children }: { children: ReactNode }) => {
  const context = useProductClient();
  const { isSignedIn } = useSessionPhase();
  const organization = useQuery({
    ...sharedReads.organization(context),
    enabled: isSignedIn,
  });
  return (
    <OrgTimeZoneProvider
      value={organization.data?.timeZone ?? FALLBACK_TIME_ZONE}
    >
      {children}
    </OrgTimeZoneProvider>
  );
};

export const AppProviders = ({ children }: { children: ReactNode }) => (
  <ClockProvider value={appClock}>
    <PreferencesProvider storage={runtime.isFixtureMode ? null : appStorage}>
      <ErrorToastProvider>
        <SessionProvider>
          <FeedbackDraftProvider>
            <OrganizationTimeZone>{children}</OrganizationTimeZone>
          </FeedbackDraftProvider>
        </SessionProvider>
      </ErrorToastProvider>
    </PreferencesProvider>
  </ClockProvider>
);
