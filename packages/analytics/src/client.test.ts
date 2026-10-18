import { createAnalyticsClient } from "@pcobooster/analytics/client";
import type { AnalyticsSdk } from "@pcobooster/analytics/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Records a call the tests do not assert on, such as session recording toggles. */
const background: string[] = [];
const inBackground = (name: string) => () => {
  background.push(name);
};

/** A fake SDK that records what the client asks of it, in order. */
const recordingSdk = (calls: string[]): AnalyticsSdk => ({
  init: () => {
    calls.push("init");
  },
  capture: (event) => {
    calls.push(`capture:${event}`);
  },
  captureException: (error) => {
    calls.push(`exception:${error.message}`);
  },
  get_session_id: () => "session-1",
  get_distinct_id: () => "anonymous",
  get_property: () => "person-0",
  identify: () => {
    calls.push("identify");
  },
  reset: () => {
    calls.push("reset");
  },
  startSessionRecording: inBackground("start recording"),
  stopSessionRecording: inBackground("stop recording"),
  startExceptionAutocapture: inBackground("start exceptions"),
  stopExceptionAutocapture: inBackground("stop exceptions"),
});

describe(createAnalyticsClient, () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: { hostname: "pcobooster.com", pathname: "/auth" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a capture made while the SDK loads once it is ready", async () => {
    const calls: string[] = [];
    const client = createAnalyticsClient(async () => {
      calls.push("load");
      return await Promise.resolve(recordingSdk(calls));
    });

    client.initializeAnalytics("phc_key", true);
    client.captureAnalytics("sign in started");
    await vi.waitFor(() => {
      expect(calls).toContain("capture:sign in started");
    });

    expect(calls).toStrictEqual(["load", "init", "capture:sign in started"]);
  });

  it("loads nothing before analytics starts and drops held captures on sign-out", async () => {
    const calls: string[] = [];
    const client = createAnalyticsClient(async () => {
      calls.push("load");
      return await Promise.resolve(recordingSdk(calls));
    });

    client.captureAnalytics("sign in started");
    client.initializeAnalytics("phc_key", true);
    client.captureAnalytics("sign in failed");
    client.resetAnalytics();
    // After sign-out abandoned the load, nothing is held for whoever signs in next.
    client.captureAnalytics("workflow failed");
    client.initializeAnalytics("phc_key", true);
    client.captureAnalytics("workflow completed");
    await vi.waitFor(() => {
      expect(calls).toContain("capture:workflow completed");
    });

    expect(calls).toStrictEqual(["load", "init", "capture:workflow completed"]);
  });

  it("loads the SDK again after a failed download", async () => {
    const calls: string[] = [];
    let attempts = 0;
    const client = createAnalyticsClient(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("chunk failed to load");
      }
      return await Promise.resolve(recordingSdk(calls));
    });

    client.initializeAnalytics("phc_key", true);
    await vi.waitFor(() => {
      expect(attempts).toBe(1);
    });
    await Promise.resolve();
    client.initializeAnalytics("phc_key", true);
    client.captureAnalytics("sign in started");
    await vi.waitFor(() => {
      expect(calls).toContain("capture:sign in started");
    });

    expect({ attempts, calls }).toStrictEqual({
      attempts: 2,
      calls: ["init", "capture:sign in started"],
    });
  });

  it("sends an exception captured before analytics starts once the SDK is ready", async () => {
    const calls: string[] = [];
    const client = createAnalyticsClient(async () => {
      calls.push("load");
      return await Promise.resolve(recordingSdk(calls));
    });

    client.captureAnalyticsException(new Error("Menu group missing"));
    client.initializeAnalytics("phc_key", true);
    await vi.waitFor(() => {
      expect(calls).toContain("exception:Menu group missing");
    });

    expect(calls).toStrictEqual([
      "load",
      "init",
      "exception:Menu group missing",
    ]);
  });

  it("drops an exception captured before analytics when the session resets first", async () => {
    const calls: string[] = [];
    const client = createAnalyticsClient(async () => {
      await Promise.resolve();
      return recordingSdk(calls);
    });

    client.captureAnalyticsException(new Error("Menu group missing"));
    client.resetAnalytics();
    client.initializeAnalytics("phc_key", true);
    client.captureAnalyticsException(new Error("later failure"));
    await vi.waitFor(() => {
      expect(calls).toContain("exception:later failure");
    });

    expect(calls).toStrictEqual(["init", "exception:later failure"]);
  });

  it("sends an exception captured before a failed SDK download once a later start succeeds", async () => {
    const calls: string[] = [];
    let attempts = 0;
    const client = createAnalyticsClient(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("chunk failed to load");
      }
      return await Promise.resolve(recordingSdk(calls));
    });

    client.captureAnalyticsException(new Error("Menu group missing"));
    client.initializeAnalytics("phc_key", true);
    await vi.waitFor(() => {
      expect(attempts).toBe(1);
    });
    await Promise.resolve();
    client.initializeAnalytics("phc_key", true);
    await vi.waitFor(() => {
      expect(calls).toContain("exception:Menu group missing");
    });

    expect({ attempts, calls }).toStrictEqual({
      attempts: 2,
      calls: ["init", "exception:Menu group missing"],
    });
  });
});
