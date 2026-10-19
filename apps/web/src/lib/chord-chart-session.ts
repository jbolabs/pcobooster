import type {
  ChordChartArrangement,
  ChordChartLayout,
} from "@pcobooster/contracts/http/chord-charts";
import { transposeChordChartText } from "@pcobooster/planning-center-models/chord-chart";
import { parseKey } from "@pcobooster/planning-center-models/chord-chart-chords";

import { isSameDraft } from "@/lib/chord-chart-draft";
import type {
  ChordChartDraft,
  StoredChordChartSession,
} from "@/lib/chord-chart-draft";

/**
 * How long typing pauses before Save as you type saves. Each save costs about three Planning
 * Center requests (a version check, the save, and opening the preview PDF), so steady typing
 * stays far below Planning Center's 100 requests per 20 seconds.
 */
export const SAVE_AS_YOU_TYPE_PAUSE_MS = 2000;

/** A chart as Planning Center holds it at one version. */
export interface ChordChartVersion {
  readonly draft: ChordChartDraft;
  /** Planning Center's `updated_at` for this version; null when it reports none. */
  readonly updatedAt: string | null;
}

export const versionOf = (
  arrangement: ChordChartArrangement
): ChordChartVersion => ({
  draft: {
    chart: arrangement.chordChart,
    key: arrangement.chordChartKey,
    layout: arrangement.layout,
  },
  updatedAt: arrangement.updatedAt,
});

/** Someone saved a newer version in Planning Center while this editor had unsaved edits. */
export interface ChordChartConflict {
  /** Their version; null until Planning Center answers with it. */
  readonly theirs: ChordChartVersion | null;
}

/**
 * One arrangement's editing session. Planning Center owns the chart; the session tracks what
 * the editor shows against the version it builds on, and never saves over a newer version
 * until the person has seen it and chosen.
 */
export interface ChordChartSession {
  /** What the editor shows. */
  readonly draft: ChordChartDraft;
  /**
   * The chart at `baseUpdatedAt` as this editor last read or sent it. After a save it is what
   * was sent, not Planning Center's echo, so a chart Planning Center reformats on write never
   * reads as an edit (which would save again after every pause).
   */
  readonly base: ChordChartDraft;
  /** The Planning Center version edits build on; saves are refused once it is not the latest. */
  readonly baseUpdatedAt: string | null;
  /** The chart as it was when editing began, for Revert all changes. */
  readonly opening: ChordChartDraft;
  readonly conflict: ChordChartConflict | null;
  /** The person changed something in this visit; nothing saves on its own before that. */
  readonly edited: boolean;
  /** The draft being saved, while a save is out. */
  readonly saving: ChordChartDraft | null;
  /** Save as you type stopped after a failed save, until the person saves by hand. */
  readonly paused: boolean;
  /** The draft came from this browser's storage rather than Planning Center. */
  readonly restored: boolean;
}

/** Whether `candidate` is a later Planning Center version than `known`. */
export const isNewerVersion = (
  candidate: string | null,
  known: string | null
): boolean => {
  if (candidate === null) {
    return false;
  }
  if (known === null) {
    return true;
  }
  const candidateTime = Date.parse(candidate);
  const knownTime = Date.parse(known);
  if (Number.isNaN(candidateTime) || Number.isNaN(knownTime)) {
    return candidate !== known;
  }
  return candidateTime > knownTime;
};

export const isDirty = (session: ChordChartSession): boolean =>
  !isSameDraft(session.draft, session.base);

/**
 * Starts editing from Planning Center's current version. Edits this browser kept are restored
 * over it; if they build on an older version, the session opens in conflict so the person
 * chooses between them before anything saves. Revert's starting point survives only while
 * Planning Center still holds the version this browser last saw.
 */
export const startChordChartSession = (
  server: ChordChartVersion,
  stored: StoredChordChartSession | null
): ChordChartSession => {
  const fresh: ChordChartSession = {
    draft: server.draft,
    base: server.draft,
    baseUpdatedAt: server.updatedAt,
    opening: server.draft,
    conflict: null,
    edited: false,
    saving: null,
    paused: false,
    restored: false,
  };
  if (stored === null) {
    return fresh;
  }
  const sameVersion = stored.baseUpdatedAt === server.updatedAt;
  const unsaved =
    stored.draft === null || isSameDraft(stored.draft, server.draft)
      ? null
      : stored.draft;
  if (unsaved === null) {
    return sameVersion ? { ...fresh, opening: stored.opening } : fresh;
  }
  if (sameVersion) {
    return {
      ...fresh,
      draft: unsaved,
      opening: stored.opening,
      restored: true,
    };
  }
  // The stored edits build on an older version whose text this browser never kept; the
  // server's text stands in as their base, which only needs to differ from the draft.
  return {
    ...fresh,
    draft: unsaved,
    baseUpdatedAt: stored.baseUpdatedAt,
    opening: stored.opening,
    conflict: { theirs: server },
    restored: true,
  };
};

/**
 * Takes in what Planning Center reports now. A newer version replaces an unedited chart
 * silently, and its starting point for Revert, so reverting never undoes someone else's
 * change unseen. With unsaved edits (or a conflict already open) it becomes their version in
 * the conflict instead. Versions arriving while a save is out wait for it, since that save
 * produces one of them.
 */
export const receiveChordChartVersion = (
  session: ChordChartSession,
  server: ChordChartVersion
): ChordChartSession => {
  if (session.saving !== null) {
    return session;
  }
  const known = session.conflict?.theirs?.updatedAt ?? session.baseUpdatedAt;
  if (!isNewerVersion(server.updatedAt, known)) {
    return session;
  }
  if (session.conflict !== null || isDirty(session)) {
    return { ...session, conflict: { theirs: server } };
  }
  return {
    ...session,
    draft: server.draft,
    base: server.draft,
    baseUpdatedAt: server.updatedAt,
    opening: server.draft,
    paused: false,
    restored: false,
  };
};

/** Fills in their version once Planning Center answers after a refused save. */
export const receiveConflictVersion = (
  session: ChordChartSession,
  theirs: ChordChartVersion
): ChordChartSession => {
  if (session.conflict === null) {
    return session;
  }
  const current = session.conflict.theirs;
  if (
    current !== null &&
    !isNewerVersion(theirs.updatedAt, current.updatedAt)
  ) {
    return session;
  }
  return { ...session, conflict: { theirs } };
};

export const editChordChartDraft = (
  session: ChordChartSession,
  update: (draft: ChordChartDraft) => ChordChartDraft
): ChordChartSession => ({
  ...session,
  draft: update(session.draft),
  edited: true,
});

export const beginChordChartSave = (
  session: ChordChartSession,
  sent: ChordChartDraft
): ChordChartSession => ({ ...session, saving: sent });

export const chordChartSaveSucceeded = (
  session: ChordChartSession,
  updatedAt: string | null
): ChordChartSession => ({
  ...session,
  base: session.saving ?? session.base,
  baseUpdatedAt: updatedAt,
  saving: null,
  paused: false,
  restored: false,
});

/** A refused save opens the conflict and waits for their version; any failure pauses saving. */
export const chordChartSaveFailed = (
  session: ChordChartSession,
  refusedAsStale: boolean
): ChordChartSession => ({
  ...session,
  saving: null,
  paused: true,
  conflict: refusedAsStale
    ? (session.conflict ?? { theirs: null })
    : session.conflict,
});

/** Drops this editor's edits for the version someone saved in Planning Center. */
export const adoptTheirChordChart = (
  session: ChordChartSession
): ChordChartSession => {
  const theirs = session.conflict?.theirs;
  if (theirs === undefined || theirs === null) {
    return session;
  }
  return {
    ...session,
    draft: theirs.draft,
    base: theirs.draft,
    baseUpdatedAt: theirs.updatedAt,
    opening: theirs.draft,
    conflict: null,
    edited: false,
    paused: false,
    restored: false,
  };
};

/**
 * Keeps this editor's chart over theirs: the draft now builds on their version, so the next
 * save replaces it knowingly and is still refused if someone saves again first.
 */
export const keepMyChordChart = (
  session: ChordChartSession
): ChordChartSession => {
  const theirs = session.conflict?.theirs;
  if (theirs === undefined || theirs === null) {
    return session;
  }
  return {
    ...session,
    base: theirs.draft,
    baseUpdatedAt: theirs.updatedAt,
    conflict: null,
    edited: true,
    paused: false,
    restored: false,
  };
};

/** Puts back the chart as it was when editing began; saving it is an edit like any other. */
export const revertChordChart = (
  session: ChordChartSession
): ChordChartSession => ({ ...session, draft: session.opening, edited: true });

/** Drops unsaved edits for the last version saved to Planning Center. */
export const discardUnsavedChordChart = (
  session: ChordChartSession
): ChordChartSession => ({
  ...session,
  draft: session.base,
  paused: false,
  restored: false,
});

const LAYOUT_FIELDS = [
  "font",
  "fontSize",
  "columns",
  "chordColor",
  "pageSize",
  "orientation",
  "margin",
] as const satisfies readonly (keyof ChordChartLayout)[];

/**
 * Print settings `draft` changed from `reference`. Planning Center reports settings with the
 * organization's defaults filled in, so only these are written; the rest keep inheriting.
 */
export const changedLayout = (
  draft: ChordChartLayout,
  reference: ChordChartLayout
): Partial<ChordChartLayout> => {
  const changed: Partial<ChordChartLayout> = {};
  for (const field of LAYOUT_FIELDS) {
    if (draft[field] !== reference[field]) {
      Object.assign(changed, { [field]: draft[field] });
    }
  }
  return changed;
};

export interface ChordChartSaveRequest {
  readonly chordChart: string;
  readonly chordChartKey: string | null;
  readonly layout: Partial<ChordChartLayout>;
  readonly baseUpdatedAt: string | null;
}

export const chordChartSaveRequest = (
  session: ChordChartSession
): ChordChartSaveRequest => ({
  chordChart: session.draft.chart,
  chordChartKey: session.draft.key,
  layout: changedLayout(session.draft.layout, session.base.layout),
  baseUpdatedAt: session.baseUpdatedAt,
});

/**
 * What a new arrangement copied from this one starts with: the chart and key as they are now,
 * and only the print settings changed since editing began, so it inherits the rest.
 */
export const chordChartCopy = (session: ChordChartSession) => ({
  chart: session.draft.chart,
  key: session.draft.key,
  layout: changedLayout(session.draft.layout, session.opening.layout),
});

/** A save can go out now: there is something to save and no conflict waits on the person. */
export const canSaveChordChart = (session: ChordChartSession): boolean =>
  session.saving === null && session.conflict === null && isDirty(session);

export interface SaveAsYouTypeOptions {
  /** The person's Save as you type setting. */
  readonly enabled: boolean;
  /** Something on screen holds saves, such as copying to a new arrangement. */
  readonly held: boolean;
}

/**
 * Whether the next pause in typing saves. Never before the person's first edit in this visit
 * (a restored draft waits for them), never after a failed save, and never over a conflict.
 */
export const savesAsYouType = (
  session: ChordChartSession,
  options: SaveAsYouTypeOptions
): boolean =>
  options.enabled &&
  !options.held &&
  session.edited &&
  !session.paused &&
  canSaveChordChart(session);

/** Why the editor can't be left with every edit saved. */
export type ChordChartExitBlock = "conflict" | "failed" | "manual";

/**
 * What leaving the editor needs right now. `leave` only once the draft on screen is the one
 * Planning Center holds; while a save is out, `wait` and ask again when it lands (edits made
 * meanwhile then need another `save`). Edits that can't save on their own block leaving.
 */
export type ChordChartExit =
  | { readonly kind: "leave" }
  | { readonly kind: "wait" }
  | { readonly kind: "save" }
  | { readonly kind: "blocked"; readonly reason: ChordChartExitBlock };

export const chordChartExit = (
  session: ChordChartSession | null,
  saveAsYouType: boolean
): ChordChartExit => {
  if (session === null) {
    return { kind: "leave" };
  }
  if (session.saving !== null) {
    return { kind: "wait" };
  }
  if (session.conflict !== null) {
    return { kind: "blocked", reason: "conflict" };
  }
  if (!isDirty(session)) {
    return { kind: "leave" };
  }
  if (session.paused) {
    return { kind: "blocked", reason: "failed" };
  }
  return saveAsYouType
    ? { kind: "save" }
    : { kind: "blocked", reason: "manual" };
};

export type ChordChartSaveStatus = "saved" | "saving" | "unsaved";

export const chordChartSaveStatus = (
  session: ChordChartSession
): ChordChartSaveStatus => {
  if (session.saving !== null) {
    return "saving";
  }
  return isDirty(session) ? "unsaved" : "saved";
};

/**
 * What this browser keeps between visits: unsaved edits, and where editing began while the
 * chart differs from it. Null once there is nothing to keep.
 */
export const storedChordChartSession = (
  session: ChordChartSession,
  now: number
): StoredChordChartSession | null => {
  const dirty = isDirty(session);
  if (!dirty && isSameDraft(session.draft, session.opening)) {
    return null;
  }
  return {
    savedAt: now,
    baseUpdatedAt: session.baseUpdatedAt,
    draft: dirty ? session.draft : null,
    opening: session.opening,
  };
};

/** Text an import brings in, and the key its chords are written in when it says. */
export interface ChordChartImportText {
  readonly chart: string;
  readonly key: string | null;
}

export const importIntoChordChart = (
  draft: ChordChartDraft,
  text: ChordChartImportText,
  mode: "replace" | "append"
): ChordChartDraft => {
  if (mode === "replace") {
    return { ...draft, chart: text.chart, key: text.key ?? draft.key };
  }
  const current = draft.chart.trimEnd();
  return {
    ...draft,
    chart: current === "" ? text.chart : `${current}\n\n${text.chart}`,
  };
};

/** Rewrites the chords into another key and marks the chart as written there. */
export const transposeChordChartDraft = (
  draft: ChordChartDraft,
  keyName: string
): ChordChartDraft => {
  const from = parseKey(draft.key);
  const to = parseKey(keyName);
  if (from === null || to === null) {
    return draft;
  }
  return {
    ...draft,
    chart: transposeChordChartText(draft.chart, from, to),
    key: to.name,
  };
};
