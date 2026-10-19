import { Forbidden } from "@pcobooster/contracts/faults/forbidden";
import { NotFound } from "@pcobooster/contracts/faults/not-found";
import type { chordChartArrangementSchema } from "@pcobooster/contracts/http/chord-charts";
import type { keyOptionSchema } from "@pcobooster/contracts/http/song-schemas";
import type { songHistoryEntrySchema } from "@pcobooster/contracts/http/songs";

import { displayKey } from "../../lib/song-keys";
import { songDisplayTitle } from "./library";

/**
 * The iOS song screen's own rules: key labels, load failures, and naming the song. The facts,
 * history, and arrangement rows it shares with the web live in
 * `@pcobooster/planning-center-models/song-detail`.
 */
export type SongHistoryEntry = typeof songHistoryEntrySchema.Type;
export type ChordChartArrangement = typeof chordChartArrangementSchema.Type;
export type KeyOption = typeof keyOptionSchema.Type;

/** "G", or "Jordan's key (A)" when the key has its own name. */
export const keyOptionLabel = (key: KeyOption): string => {
  const name = key.name.trim();
  const start = key.startingKey ?? "";
  if (name === "" || name === start) {
    return start === "" ? "No key" : displayKey(start);
  }
  return start === "" ? name : `${name} (${displayKey(start)})`;
};

/** Why a song didn't open, so the screen can say what would help (`chordChartLoadFailure`). */
export type SongLoadFailure =
  | { readonly kind: "not-found" }
  | { readonly kind: "no-access"; readonly message: string }
  | { readonly kind: "failed" };

export const songLoadFailure = (error: Error | null): SongLoadFailure => {
  if (error instanceof NotFound) {
    return { kind: "not-found" };
  }
  if (error instanceof Forbidden) {
    return {
      kind: "no-access",
      message:
        error.message === ""
          ? "Your Planning Center account can’t view songs in Services."
          : error.message,
    };
  }
  return { kind: "failed" };
};

export interface SongLoadFailureCopy {
  readonly title: string;
  readonly message: string;
  readonly canRetry: boolean;
}

export const songLoadFailureCopy = (
  failure: SongLoadFailure
): SongLoadFailureCopy => {
  if (failure.kind === "not-found") {
    return {
      title: "Song not found",
      message:
        "Planning Center has no song at this link. It may have been deleted, or it belongs to another organization.",
      canRetry: false,
    };
  }
  if (failure.kind === "no-access") {
    return {
      title: "You can’t open this song",
      message: failure.message,
      canRetry: false,
    };
  }
  return {
    title: "This song didn’t load",
    message: "Planning Center didn’t answer. Try again in a moment.",
    canRetry: true,
  };
};

interface ReadState {
  readonly status: "pending" | "error" | "success";
  readonly error: Error | null;
}

/**
 * The whole screen shows a failure only when nothing names the song and every read it started
 * failed; otherwise each section shows its own state. The chart read's fault is the most
 * specific, then options, then history.
 */
export const songScreenFailure = ({
  titleKnown,
  history,
  options,
  chart,
}: {
  titleKnown: boolean;
  history: ReadState;
  options: ReadState | null;
  chart: ReadState | null;
}): SongLoadFailure | null => {
  if (titleKnown) {
    return null;
  }
  const started = [history, options, chart].filter(
    (read): read is ReadState => read !== null
  );
  if (!started.every((read) => read.status === "error")) {
    return null;
  }
  return songLoadFailure(chart?.error ?? options?.error ?? history.error);
};

const THEME_SEPARATOR = ",";

interface SongNameSource {
  readonly title: string;
  readonly author: string;
}

export interface SongIdentity {
  /** The display title; null until something names the song. */
  readonly title: string | null;
  /** The title as Planning Center has it, for the recent list. */
  readonly rawTitle: string | null;
  readonly author: string;
  readonly themes: readonly string[];
}

/**
 * Names the song from the first read that knows it: the options, the chart, the library's
 * cached row, then this device's recent list.
 */
export const songIdentity = (
  sources: readonly (SongNameSource | undefined)[],
  themes: string
): SongIdentity => {
  const source = sources.find((candidate) => candidate !== undefined);
  return {
    title: source === undefined ? null : songDisplayTitle(source.title),
    rawTitle: source?.title ?? null,
    author: source?.author ?? "",
    themes: themes
      .split(THEME_SEPARATOR)
      .map((theme) => theme.trim())
      .filter((theme) => theme !== ""),
  };
};
