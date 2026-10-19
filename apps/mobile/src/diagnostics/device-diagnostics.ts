/**
 * The app's one diagnostics instance, wired to the device: PostHog over `fetch`, the pending-fatal
 * file, and the installed release. `index.ts` imports this right after the sentinel and the
 * polyfills, before any app module, and it connects itself to the sentinel, so a crash while the
 * router or a screen module evaluates is already kept.
 *
 * `expo-file-system` ships with `expo` itself, so its native module is always linked. A file
 * operation that fails (a full disk) or is cut short loses only the report being written; the
 * reports kept before it survive (`pending-fatals.ts`). The sentinel still forwards the fatal to
 * React Native, and non-fatal reports, kept in memory, are unaffected.
 */
import { Schema } from "effect";
import { File, Paths } from "expo-file-system";

import { makeDiagnostics } from "./diagnostics-client";
import type { CapturedEvent, Diagnostics } from "./diagnostics-client";
import { fatalSentinel } from "./fatal-sentinel";
import { makePendingFatals } from "./pending-fatals";
import type {
  PendingFatalCopies,
  PurgeMarker,
  SyncTextFile,
} from "./pending-fatals";
import { releaseMetadata } from "./release-metadata";

const POSTHOG_HOST = "https://us.i.posthog.com";
const SEND_TIMEOUT_MS = 10_000;
const PENDING_FILES = [
  "pcobooster-pending-fatals-a.json",
  "pcobooster-pending-fatals-b.json",
] as const;

const PURGE_FILE = "pcobooster-pending-fatals-purged";

const readSetting = Schema.decodeUnknownSync(Schema.String);
const key = readSetting(process.env.EXPO_PUBLIC_POSTHOG_KEY ?? "");

const textFile = (name: string): SyncTextFile => {
  const file = new File(Paths.cache, name);
  return {
    read: () => (file.exists ? file.textSync() : null),
    write: (text) => {
      if (!file.exists) {
        file.create();
      }
      file.writeSync(text);
    },
    remove: () => {
      if (file.exists) {
        file.delete();
      }
    },
  };
};

/** The pending-fatal files in Caches (never backed up), or null when they cannot be opened. */
const openPendingFiles = (): {
  copies: PendingFatalCopies;
  purgeMarker: PurgeMarker;
} | null => {
  try {
    const marker = new File(Paths.cache, PURGE_FILE);
    return {
      copies: [textFile(PENDING_FILES[0]), textFile(PENDING_FILES[1])],
      purgeMarker: {
        exists: () => marker.exists,
        create: () => {
          if (!marker.exists) {
            marker.create();
          }
        },
        remove: () => {
          if (marker.exists) {
            marker.delete();
          }
        },
      },
    };
  } catch {
    return null;
  }
};

const sendToPostHog = async (
  events: readonly CapturedEvent[],
  cancelled: AbortSignal
): Promise<boolean> => {
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };
  cancelled.addEventListener("abort", abort);
  const timer = setTimeout(abort, SEND_TIMEOUT_MS);
  try {
    const response = await fetch(`${POSTHOG_HOST}/batch/`, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: key, batch: events }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    cancelled.removeEventListener("abort", abort);
  }
};

const enabled = !__DEV__ && key !== "";
const pendingFiles = enabled ? openPendingFiles() : null;

export const deviceDiagnostics: Diagnostics = makeDiagnostics({
  enabled,
  release: releaseMetadata,
  transport: sendToPostHog,
  pending:
    pendingFiles === null
      ? null
      : makePendingFatals(
          pendingFiles.copies,
          Date.now,
          pendingFiles.purgeMarker
        ),
  verificationBuild:
    readSetting(process.env.EXPO_PUBLIC_DIAGNOSTICS_PROBES ?? "") === "1",
});

fatalSentinel.setRecorder(
  enabled
    ? (cause, kind) => {
        if (kind === "fatal") {
          deviceDiagnostics.recordFatal(cause);
          return;
        }
        deviceDiagnostics.captureException(cause, kind);
      }
    : null
);
