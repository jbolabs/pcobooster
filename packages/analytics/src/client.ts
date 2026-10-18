import { Schema } from "effect";
import type {
  CaptureOptions,
  CaptureResult,
  ExceptionAutoCaptureConfig,
  PostHog,
  PostHogConfig,
  Properties,
} from "posthog-js";

import {
  analyticsUrl,
  canInitializeAnalytics,
  canRecordSession,
  canReportException,
  prepareAnalyticsEvent,
} from "./privacy";
import { replayOptions } from "./replay";

const isString = Schema.is(Schema.String);

export type AnalyticsEvent =
  | "marketing cta clicked"
  | "sign in started"
  | "sign in failed"
  | "app opened"
  | "workflow completed"
  | "workflow failed";
/** The parts of the PostHog SDK the client uses; the real SDK, or a test's fake. */
export interface AnalyticsSdk {
  readonly init: (token: string, config: Partial<PostHogConfig>) => void;
  readonly capture: (
    event: string,
    properties: Properties,
    options?: CaptureOptions
  ) => void;
  readonly captureException: (error: Error, properties: Properties) => void;
  readonly get_session_id: () => string;
  readonly get_distinct_id: () => string;
  readonly get_property: (name: "$user_id") => string | undefined;
  readonly identify: (distinctId: string) => void;
  readonly reset: () => void;
  readonly startSessionRecording: () => void;
  readonly stopSessionRecording: () => void;
  readonly startExceptionAutocapture: (
    config: ExceptionAutoCaptureConfig
  ) => void;
  readonly stopExceptionAutocapture: () => void;
}

/** Most captures held while the SDK loads; a sign-in click lands well within this. */
const MAX_HELD_CAPTURES = 20;

/**
 * The browser analytics client. `loadSdk` brings in the SDK the first time analytics starts, so
 * pages that never initialize (most of the product until the account answers) never download or
 * run it. Captures sent after analytics starts but before the SDK loads are held and sent once
 * it has.
 */
export const createAnalyticsClient = (
  loadSdkModule: () => Promise<AnalyticsSdk>
) => {
  /** The SDK once it is initialized. */
  let posthog: AnalyticsSdk | undefined;
  let loadingSdk: Promise<AnalyticsSdk> | undefined;
  /** Captures sent after analytics started but before the SDK finished loading, in order. */
  const heldCaptures: (() => void)[] = [];
  /**
   * Exceptions captured before analytics starts. The chord-chart editor can render from cache
   * and throw before the account response calls `initializeAnalytics`, and `holdUntilLoaded`
   * only queues once that start is in flight.
   */
  const heldExceptions: (() => void)[] = [];

  let currentUserId: string | undefined;
  /** Raised by `resetAnalytics`, so an initialization still loading the SDK identifies nobody. */
  let generation = 0;
  /** The generation whose initialization is waiting for the SDK, if any. */
  let initializingGeneration: number | undefined;

  /**
   * Holds a capture while this session's initialization loads the SDK. Outside analytics, or
   * after a sign-out abandoned that load, there is no session to send it for.
   */
  const holdUntilLoaded = (capture: () => void): void => {
    if (
      initializingGeneration === generation &&
      heldCaptures.length < MAX_HELD_CAPTURES
    ) {
      heldCaptures.push(capture);
    }
  };

  /** Keeps a crash that happened before any initialization, up to the same cap as held captures. */
  const rememberException = (capture: () => void): void => {
    if (heldExceptions.length < MAX_HELD_CAPTURES) {
      heldExceptions.push(capture);
    }
  };

  const loadSdk = async (): Promise<AnalyticsSdk> => {
    loadingSdk ??= loadSdkModule();
    try {
      return await loadingSdk;
    } catch (error) {
      // A failed download is retried by the next initialization, not cached for the session.
      loadingSdk = undefined;
      heldCaptures.length = 0;
      throw error;
    }
  };

  /** Replay retains its own route gate; errors cover every authenticated product route. */
  const syncSessionRecording = (sdk: AnalyticsSdk): void => {
    if (
      canRecordSession(window.location.pathname, currentUserId !== undefined)
    ) {
      // Respect the project's sampling and minimum-duration controls.
      sdk.startSessionRecording();
    } else {
      sdk.stopSessionRecording();
    }
    if (
      canReportException(window.location.pathname, currentUserId !== undefined)
    ) {
      sdk.startExceptionAutocapture({
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      });
    } else {
      sdk.stopExceptionAutocapture();
    }
  };

  const beforeSend = (event: CaptureResult | null): CaptureResult | null => {
    if (posthog !== undefined && event?.event === "$pageview") {
      // Also stop capture on same-document navigation outside product routes.
      syncSessionRecording(posthog);
    }
    return prepareAnalyticsEvent(
      event,
      window.location.pathname,
      currentUserId !== undefined
    );
  };

  const captureAnalytics = (
    event: AnalyticsEvent,
    properties: Record<string, string | number | boolean> = {}
  ): void => {
    if (posthog === undefined) {
      holdUntilLoaded(() => {
        captureAnalytics(event, properties);
      });
      return;
    }
    try {
      posthog.capture(
        event,
        properties,
        event === "marketing cta clicked" || event === "sign in started"
          ? { transport: "sendBeacon", send_instantly: true }
          : undefined
      );
    } catch {
      // Event delivery is best effort.
    }
  };

  /** Initializes the SDK once, or identifies a different person on a later call. */
  const startSdk = (
    sdk: AnalyticsSdk,
    key: string,
    productDocument: boolean,
    userId: string | undefined
  ): void => {
    if (posthog === undefined) {
      sdk.init(key, {
        api_host: "https://us.i.posthog.com",
        ui_host: "https://us.posthog.com",
        defaults: "2026-01-30",
        person_profiles: "identified_only",
        autocapture: false,
        capture_pageview: "history_change",
        capture_pageleave: true,
        disable_session_recording: true,
        session_recording: replayOptions,
        disable_surveys: true,
        disable_conversations: true,
        disable_product_tours: true,
        disable_web_experiments: true,
        disable_external_dependency_loading: !productDocument,
        capture_heatmaps: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        capture_performance: false,
        rageclick: false,
        // Replay needs remote configuration; feature flag evaluation stays disabled.
        advanced_disable_flags: !productDocument,
        advanced_disable_feature_flags: true,
        enable_recording_console_log: false,
        respect_dnt: true,
        cross_subdomain_cookie: false,
        disable_capture_url_hashes: true,
        get_current_url: analyticsUrl,
        before_send: beforeSend,
        loaded: () => {
          if (userId !== undefined) {
            const previousUserId: unknown = sdk.get_property("$user_id");
            if (isString(previousUserId) && previousUserId !== userId) {
              sdk.reset();
            }
            sdk.identify(userId);
          }
        },
      });
      posthog = sdk;
      for (const capture of heldCaptures.splice(0)) {
        capture();
      }
      for (const capture of heldExceptions.splice(0)) {
        capture();
      }
      if (userId !== undefined) {
        captureAnalytics("app opened");
      }
    } else if (userId !== undefined && sdk.get_distinct_id() !== userId) {
      const previousUserId: unknown = sdk.get_property("$user_id");
      if (isString(previousUserId) && previousUserId !== userId) {
        sdk.reset();
      }
      sdk.identify(userId);
      captureAnalytics("app opened");
    }
  };

  /** Analytics must never prevent sign-in, navigation, or a successful provider write. */
  const initializeAnalytics = (
    key: string | undefined,
    production: boolean,
    userId?: string
  ): void => {
    if (
      typeof window === "undefined" ||
      !canInitializeAnalytics(key, window.location.hostname, production) ||
      key === undefined ||
      key === ""
    ) {
      return;
    }
    const productDocument =
      window.location.pathname === "/auth" ||
      canReportException(window.location.pathname, true);
    currentUserId = userId;
    const startedIn = generation;
    initializingGeneration = generation;
    void (async () => {
      try {
        const sdk = await loadSdk();
        if (startedIn !== generation) {
          return;
        }
        startSdk(sdk, key, productDocument, userId);
        syncSessionRecording(sdk);
      } catch {
        // SDK, network, or browser-storage failures must not affect the product.
      }
    })();
  };

  /**
   * Reports an error React caught in an error boundary, which never reaches the global
   * handlers that exception autocapture listens to. A crash can happen before the account
   * response starts analytics; that report is held until the SDK starts, or dropped on
   * reset. The privacy guard drops it outside authenticated product routes.
   */
  const captureAnalyticsException = (
    error: Error,
    properties: Record<string, string | number | boolean> = {}
  ): void => {
    if (posthog === undefined) {
      if (initializingGeneration === generation) {
        holdUntilLoaded(() => {
          captureAnalyticsException(error, properties);
        });
      } else {
        rememberException(() => {
          captureAnalyticsException(error, properties);
        });
      }
      return;
    }
    try {
      posthog.captureException(error, properties);
    } catch {
      // Error reporting is best effort.
    }
  };

  /** Lets server-side events, such as feedback, link to this session's replay. */
  const getAnalyticsSessionId = (): string | null => {
    if (posthog === undefined) {
      return null;
    }
    try {
      return posthog.get_session_id() || null;
    } catch {
      return null;
    }
  };

  const resetAnalytics = (): void => {
    currentUserId = undefined;
    generation += 1;
    heldCaptures.length = 0;
    heldExceptions.length = 0;
    if (posthog !== undefined) {
      try {
        posthog.stopSessionRecording();
        posthog.stopExceptionAutocapture();
        posthog.reset();
      } catch {
        // Sign-out must work even when browser storage is unavailable.
      }
    }
  };

  return {
    captureAnalytics,
    initializeAnalytics,
    captureAnalyticsException,
    getAnalyticsSessionId,
    resetAnalytics,
  };
};

const importPostHog = async (): Promise<PostHog> => {
  const sdk = await import("posthog-js");
  return sdk.posthog;
};

const browserAnalytics = createAnalyticsClient(importPostHog);

/** Sends a product event once analytics has started for this document. */
export const { captureAnalytics } = browserAnalytics;
/** Analytics must never prevent sign-in, navigation, or a successful provider write. */
export const { initializeAnalytics } = browserAnalytics;
/** Reports an error React caught in an error boundary (see `createAnalyticsClient`). */
export const { captureAnalyticsException } = browserAnalytics;
/** Lets server-side events, such as feedback, link to this session's replay. */
export const { getAnalyticsSessionId } = browserAnalytics;
export const { resetAnalytics } = browserAnalytics;
