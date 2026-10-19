import { failureMessage } from "@pcobooster/client/product-client";
import type {
  ChordChartArrangement,
  ChordChartLayout,
} from "@pcobooster/contracts/http/chord-charts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
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

/** What follows a save someone waits on. */
export interface SaveOutcome {
  readonly onSaved: () => void;
  readonly onFailed: () => void;
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
  const [session, setSession] = useState<ChordChartSession | null>(() =>
    fresh ? startFromBrowser(arrangement) : null
  );
  // Editing starts from a copy read on opening, then keeps up with newer versions.
  if (session === null) {
    if (fresh) {
      setSession(startFromBrowser(arrangement));
    }
  } else {
    const received = receiveChordChartVersion(session, server);
    if (received !== session) {
      setSession(received);
    }
  }
  const update = (
    change: (current: ChordChartSession) => ChordChartSession
  ) => {
    setSession((current) => (current === null ? current : change(current)));
  };
  const edit = (change: (draft: ChordChartDraft) => ChordChartDraft) => {
    update((current) => editChordChartDraft(current, change));
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
  // What to do once the save in flight lands, for leaving the editor after it.
  const afterSaveRef = useRef<SaveOutcome | null>(null);
  const settleAfterSave = (saved: boolean) => {
    const after = afterSaveRef.current;
    afterSaveRef.current = null;
    if (saved) {
      after?.onSaved();
    } else {
      after?.onFailed();
    }
  };
  const save = (current: ChordChartSession) => {
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
          update((latest) => chordChartSaveSucceeded(latest, saved.updatedAt));
          settleAfterSave(true);
        },
        onError: (error) => {
          const refusedAsStale = isChordChartConflict(error);
          update((latest) => chordChartSaveFailed(latest, refusedAsStale));
          settleAfterSave(false);
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
        onSettled: () => {
          sendingRef.current = false;
        },
      }
    );
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
     * Saves what is pending (or waits for the save already in flight), then reports how it
     * went; with nothing to save it reports saved at once.
     */
    handleSaveThen: (outcome: SaveOutcome) => {
      if (sendingRef.current) {
        afterSaveRef.current = outcome;
        return;
      }
      if (session === null || !canSaveChordChart(session)) {
        outcome.onSaved();
        return;
      }
      afterSaveRef.current = outcome;
      save(session);
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
      if (session === null) {
        return;
      }
      const kept = keepMyChordChart(session);
      setSession(kept);
      save(kept);
    },
    handleRetryTheirs: () => {
      void loadTheirVersion();
    },
    /**
     * After copying to a new arrangement: unsaved edits went there, so this one forgets them,
     * but keeps where editing began, so its own saved changes can still be reverted.
     */
    handleCopied: () => {
      if (session === null) {
        return;
      }
      const kept = discardUnsavedChordChart(session);
      setSession(kept);
      writeChordChartSession(
        arrangement.id,
        storedChordChartSession(kept, Date.now())
      );
    },
  };
};

export type ChordChartWorkspace = ReturnType<typeof useChordChartWorkspace>;
