import { failureMessage } from "@pcobooster/client/product-client";
import type {
  ChordChartArrangement,
  ChordChartLayout,
} from "@pcobooster/contracts/http/chord-charts";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { useBrowserStorage } from "@/hooks/use-browser-storage";
import {
  fetchLatestChordChartArrangement,
  isChordChartConflict,
  useChordChartSongReadOnOpen,
  useSaveChordChart,
} from "@/hooks/use-chord-chart-song";
import {
  isSameDraft,
  pruneChordChartDrafts,
  readChordChartSession,
  writeChordChartSession,
} from "@/lib/chord-chart-draft";
import type { ChordChartDraft } from "@/lib/chord-chart-draft";
import {
  SAVE_AS_YOU_TYPE_PAUSE_MS,
  adoptTheirChordChart,
  beginChordChartSave,
  chordChartExit,
  canSaveChordChart,
  chordChartCopy,
  chordChartSaveFailed,
  chordChartSaveRequest,
  chordChartSaveStatus,
  chordChartSaveSucceeded,
  discardUnsavedChordChart,
  editChordChartDraft,
  importIntoChordChart,
  isDirty,
  keepMyChordChart,
  receiveChordChartVersion,
  receiveConflictVersion,
  revertChordChart,
  savesAsYouType,
  startChordChartSession,
  storedChordChartSession,
  transposeChordChartDraft,
  versionOf,
} from "@/lib/chord-chart-session";
import type {
  ChordChartExitBlock,
  ChordChartImportText,
  ChordChartSession,
} from "@/lib/chord-chart-session";

const DRAFT_WRITE_DELAY_MS = 400;
/** Kept under the setting's earlier name, Auto-refresh, so turning it off still holds. */
const SAVE_AS_YOU_TYPE_STORAGE_KEY = "pcobooster:chord-chart-auto-refresh";
const SAVE_AS_YOU_TYPE_OFF = "off";

const schedule = (run: () => void, delayMs: number): (() => void) => {
  const timeout = window.setTimeout(run, delayMs);
  return () => {
    window.clearTimeout(timeout);
  };
};

const startFromBrowser = (arrangement: ChordChartArrangement) =>
  startChordChartSession(
    versionOf(arrangement),
    readChordChartSession(arrangement.id)
  );

/** How leaving the editor turned out: every edit saved, or why some can't be. */
export interface ExitOutcome {
  readonly onSaved: () => void;
  readonly onBlocked: (reason: ChordChartExitBlock) => void;
}

export interface ChordChartWorkspaceOptions {
  readonly songId: string;
  readonly arrangement: ChordChartArrangement;
  /** Something on screen holds saves, such as copying to a new arrangement. */
  readonly held: boolean;
}

/**
 * One arrangement's editing session (see `chord-chart-session.ts` for every decision it
 * makes). Services renders only saved charts, so with Save as you type on, a pause in typing
 * saves and the preview renders the result. Unsaved edits, and where editing began, stay in
 * this browser between visits.
 */
export const useChordChartWorkspace = ({
  songId,
  arrangement,
  held,
}: ChordChartWorkspaceOptions) => {
  const queryClient = useQueryClient();
  const fresh = useChordChartSongReadOnOpen(songId);
  const server = useMemo(() => versionOf(arrangement), [arrangement]);
  // The person's last change to the session; null until they make one.
  const [written, setWritten] = useState<ChordChartSession | null>(null);
  // What the editor shows: editing starts from a copy read on opening (with this browser's
  // unsaved edits), and always takes in newer Planning Center versions. Both are derived
  // here, never written during render, so every write goes through `update`.
  const session = useMemo(() => {
    if (written !== null) {
      return receiveChordChartVersion(written, server);
    }
    return fresh ? startFromBrowser(arrangement) : null;
  }, [written, fresh, arrangement, server]);
  // The session as shown, for decisions made after a save lands.
  const sessionRef = useRef(session);
  useLayoutEffect(() => {
    sessionRef.current = session;
  }, [session]);
  /** The one way the session changes: builds on the latest and keeps the ref in step. */
  const update = (
    change: (current: ChordChartSession) => ChordChartSession
  ): ChordChartSession | null => {
    const { current } = sessionRef;
    if (current === null) {
      return null;
    }
    const next = change(current);
    sessionRef.current = next;
    setWritten(next);
    return next;
  };
  // Set while leaving waits for the last save; edits are refused so nothing lands after it.
  const exitRef = useRef<ExitOutcome | null>(null);
  const [committing, setCommitting] = useState(false);
  // Leaving is an explicit request to save, worth one attempt even with saving off or paused.
  const attemptLeftRef = useRef(false);
  const edit = (change: (draft: ChordChartDraft) => ChordChartDraft) => {
    if (exitRef.current === null) {
      update((current) => editChordChartDraft(current, change));
    }
  };

  const [storedSetting, setStoredSetting] = useBrowserStorage(
    SAVE_AS_YOU_TYPE_STORAGE_KEY
  );
  const saveAsYouType = storedSetting !== SAVE_AS_YOU_TYPE_OFF;
  const saveChart = useSaveChordChart(songId);

  useEffect(() => {
    pruneChordChartDrafts(Date.now());
  }, []);

  useEffect(
    () =>
      session === null
        ? undefined
        : schedule(() => {
            writeChordChartSession(
              arrangement.id,
              storedChordChartSession(session, Date.now())
            );
          }, DRAFT_WRITE_DELAY_MS),
    [arrangement.id, session]
  );

  // Leaving keeps the latest draft in this browser even if its delayed write hadn't run.
  useEffect(
    () => () => {
      const latest = sessionRef.current;
      if (latest !== null) {
        writeChordChartSession(
          arrangement.id,
          storedChordChartSession(latest, Date.now())
        );
      }
    },
    [arrangement.id]
  );

  const loadTheirVersion = async () => {
    try {
      const latest = await fetchLatestChordChartArrangement(
        queryClient,
        songId,
        arrangement.id
      );
      if (latest !== null) {
        update((current) => receiveConflictVersion(current, versionOf(latest)));
      }
    } catch {
      toast.error("Planning Center’s latest version didn’t load. Try again.");
    }
  };

  // Set before the session shows the save, so a second Save in the same moment sends nothing.
  const sendingRef = useRef(false);
  /** Sends the draft; `onLanded` runs once Planning Center answers, either way. */
  const sendSave = (current: ChordChartSession, onLanded: () => void) => {
    if (sendingRef.current || !canSaveChordChart(current)) {
      return;
    }
    sendingRef.current = true;
    const sent = current.draft;
    const request = chordChartSaveRequest(current);
    update((latest) => beginChordChartSave(latest, sent));
    saveChart.mutate(
      { songId, arrangementId: arrangement.id, ...request },
      {
        onSuccess: (saved) => {
          sendingRef.current = false;
          update((latest) => chordChartSaveSucceeded(latest, saved.updatedAt));
          onLanded();
        },
        onError: (error) => {
          sendingRef.current = false;
          const refusedAsStale = isChordChartConflict(error);
          update((latest) => chordChartSaveFailed(latest, refusedAsStale));
          onLanded();
          if (refusedAsStale) {
            void loadTheirVersion();
            return;
          }
          toast.error(
            failureMessage(
              error,
              "Planning Center didn’t save the chart. Try again."
            )
          );
        },
      }
    );
  };

  /** Moves a pending exit on: saves what is left, waits for a save out, or settles it. */
  const continueExit = () => {
    const outcome = exitRef.current;
    if (outcome === null) {
      return;
    }
    const exit = chordChartExit(sessionRef.current, {
      saveAsYouType,
      attemptLeft: attemptLeftRef.current,
    });
    if (exit.kind === "wait") {
      return;
    }
    if (exit.kind === "save") {
      const latest = sessionRef.current;
      if (latest !== null) {
        // Leaving asks for one save; a second failure then blocks instead of looping.
        attemptLeftRef.current = false;
        sendSave(latest, continueExit);
      }
      return;
    }
    exitRef.current = null;
    setCommitting(false);
    if (exit.kind === "leave") {
      outcome.onSaved();
    } else {
      outcome.onBlocked(exit.reason);
    }
  };
  // Every save checks a pending exit when it lands, autosaves included.
  const save = (current: ChordChartSession) => {
    sendSave(current, continueExit);
  };

  const autosaving =
    session !== null &&
    savesAsYouType(session, { enabled: saveAsYouType, held });
  const draft = session === null ? server.draft : session.draft;
  const saveAfterPause = useEffectEvent((typed: ChordChartDraft) => {
    if (session?.draft === typed) {
      save(session);
    }
  });
  // Each edit restarts the wait, so the save goes out once typing pauses.
  useEffect(
    () =>
      autosaving
        ? schedule(() => {
            saveAfterPause(draft);
          }, SAVE_AS_YOU_TYPE_PAUSE_MS)
        : undefined,
    [autosaving, draft]
  );

  const canSave = session !== null && canSaveChordChart(session);
  return {
    /** Planning Center's fresh copy is in and editing can begin. */
    ready: session !== null,
    draft,
    status: session === null ? "saved" : chordChartSaveStatus(session),
    saveAsYouType,
    canSave,
    /** Leaving waits for the last save; the editor takes no edits meanwhile. */
    committing,
    /** What leaving (an explicit request to save) needs now, for guarding navigation away. */
    exit: chordChartExit(session, { saveAsYouType, attemptLeft: true }),
    /** The last save didn't reach Planning Center, so typing no longer saves on its own. */
    saveFailed: session?.paused ?? false,
    /** Saving waits for the person: the setting is off, paused, or yet to see an edit. */
    needsSave: canSave && !autosaving,
    conflict: session?.conflict ?? null,
    restored:
      session !== null &&
      session.restored &&
      session.conflict === null &&
      isDirty(session),
    revertable:
      session !== null && !isSameDraft(session.draft, session.opening),
    /** This visit already saved changes to the arrangement. */
    savedChanges:
      session !== null && !isSameDraft(session.base, session.opening),
    unsavedChanges: session !== null && isDirty(session),
    /** What a copy to a new arrangement starts with. */
    copy: session === null ? null : chordChartCopy(session),
    handleSaveAsYouTypeChange: (enabled: boolean) => {
      setStoredSetting(enabled ? null : SAVE_AS_YOU_TYPE_OFF);
    },
    handleSave: () => {
      if (session !== null) {
        save(session);
      }
    },
    /**
     * Leaves only with every edit saved: saves until the draft on screen is the one Planning
     * Center holds (edits typed while a save is out go in the next one), refusing new edits
     * meanwhile. Reports why when edits can't save (a conflict, a failed save, saving off).
     */
    handleExit: (outcome: ExitOutcome) => {
      // A newer request (Save and leave after Done) takes over the pending one.
      exitRef.current = outcome;
      attemptLeftRef.current = true;
      setCommitting(true);
      continueExit();
    },
    /** Stops waiting to leave; any save already out still lands. */
    handleCancelExit: () => {
      exitRef.current = null;
      setCommitting(false);
    },
    handleChartChange: (chart: string) => {
      edit((current) => ({ ...current, chart }));
    },
    handleKeyChange: (key: string | null) => {
      edit((current) => ({ ...current, key }));
    },
    handleLayoutChange: (layout: ChordChartLayout) => {
      edit((current) => ({ ...current, layout }));
    },
    handleTranspose: (keyName: string) => {
      edit((current) => transposeChordChartDraft(current, keyName));
    },
    /** Replacing offers Undo, since it bypasses the text box's own undo history. */
    handleImport: (text: ChordChartImportText, mode: "replace" | "append") => {
      if (session === null) {
        return;
      }
      const previous = session.draft;
      edit((current) => importIntoChordChart(current, text, mode));
      if (mode === "replace" && previous.chart.trim() !== "") {
        toast("Chart replaced.", {
          action: {
            label: "Undo",
            onClick: () => {
              edit(() => previous);
            },
          },
        });
      }
    },
    handleRevert: () => {
      update(revertChordChart);
    },
    handleDiscard: () => {
      update(discardUnsavedChordChart);
    },
    handleUseTheirs: () => {
      update(adoptTheirChordChart);
    },
    /** Saves the editor's chart as it is now over their version, still version-checked. */
    handleKeepMine: () => {
      const kept = update(keepMyChordChart);
      if (kept !== null) {
        save(kept);
      }
    },
    handleRetryTheirs: () => {
      void loadTheirVersion();
    },
    /**
     * After copying to a new arrangement: unsaved edits went there, so this one forgets them,
     * but keeps where editing began, so its own saved changes can still be reverted.
     */
    handleCopied: () => {
      const kept = update(discardUnsavedChordChart);
      if (kept !== null) {
        writeChordChartSession(
          arrangement.id,
          storedChordChartSession(kept, Date.now())
        );
      }
    },
  };
};

export type ChordChartWorkspace = ReturnType<typeof useChordChartWorkspace>;
