import { describe, expect, it } from "vitest";

import type { ChordChartDraft } from "@/lib/chord-chart-draft";
import {
  adoptTheirChordChart,
  beginChordChartSave,
  canSaveChordChart,
  changedLayout,
  chordChartCopy,
  chordChartSaveFailed,
  chordChartSaveRequest,
  chordChartSaveStatus,
  chordChartSaveSucceeded,
  editChordChartDraft,
  importIntoChordChart,
  isDirty,
  isNewerVersion,
  keepMyChordChart,
  receiveChordChartVersion,
  receiveConflictVersion,
  revertChordChart,
  savesAsYouType,
  startChordChartSession,
  storedChordChartSession,
  transposeChordChartDraft,
} from "@/lib/chord-chart-session";
import type {
  ChordChartSession,
  ChordChartVersion,
} from "@/lib/chord-chart-session";

const layout = {
  font: "Times-Roman",
  fontSize: 12,
  columns: 2,
  chordColor: 1,
  pageSize: "Letter",
  orientation: "Portrait",
  margin: "0.5in",
} as const;

const NOW = Date.UTC(2026, 9, 1, 12);
const V1 = "2026-09-01T12:00:00Z";
const V2 = "2026-09-02T12:00:00Z";
const V3 = "2026-09-03T12:00:00Z";

const draft = (chart: string, key: string | null = "G"): ChordChartDraft => ({
  chart,
  key,
  layout,
});

const version = (
  chart: string,
  updatedAt: string | null
): ChordChartVersion => ({
  draft: draft(chart),
  updatedAt,
});

const typeChart = (session: ChordChartSession, chart: string) =>
  editChordChartDraft(session, (current) => ({ ...current, chart }));

const typing = { enabled: true, held: false } as const;

describe(startChordChartSession, () => {
  it("starts from Planning Center and saves nothing before the first edit", () => {
    const session = startChordChartSession(version("VERSE", V1), null);
    expect(session.draft.chart).toBe("VERSE");
    expect(isDirty(session)).toBeFalsy();
    expect(session.edited).toBeFalsy();
    expect(savesAsYouType(session, typing)).toBeFalsy();
    expect(savesAsYouType(typeChart(session, "VERSE 1"), typing)).toBeTruthy();
  });

  it("restores this browser's unsaved edits on the same version without saving them", () => {
    const session = startChordChartSession(version("VERSE", V1), {
      savedAt: NOW,
      baseUpdatedAt: V1,
      draft: draft("VERSE mine"),
      opening: draft("VERSE before"),
    });
    expect(session).toMatchObject({
      draft: draft("VERSE mine"),
      opening: draft("VERSE before"),
      restored: true,
      conflict: null,
    });
    expect(savesAsYouType(session, typing)).toBeFalsy();
    expect(canSaveChordChart(session)).toBeTruthy();
  });

  it("opens in conflict when the restored edits build on an older version", () => {
    const server = version("VERSE theirs", V2);
    const session = startChordChartSession(server, {
      savedAt: NOW,
      baseUpdatedAt: V1,
      draft: draft("VERSE mine"),
      opening: draft("VERSE"),
    });
    expect(session.draft.chart).toBe("VERSE mine");
    expect(session.conflict).toStrictEqual({ theirs: server });
    expect(canSaveChordChart(session)).toBeFalsy();
    expect(
      savesAsYouType(typeChart(session, "VERSE more"), typing)
    ).toBeFalsy();
  });

  it("keeps Revert's starting point only while Planning Center holds the version it saw", () => {
    const stored = {
      savedAt: NOW,
      baseUpdatedAt: V2,
      draft: null,
      opening: draft("VERSE original"),
    };
    const same = startChordChartSession(version("VERSE saved", V2), stored);
    expect(same.opening.chart).toBe("VERSE original");
    expect(isDirty(same)).toBeFalsy();
    const changed = startChordChartSession(version("VERSE theirs", V3), stored);
    expect(changed.opening.chart).toBe("VERSE theirs");
  });
});

describe(receiveChordChartVersion, () => {
  it("adopts a newer version silently when nothing is unsaved", () => {
    const session = startChordChartSession(version("VERSE stale", V1), null);
    const next = receiveChordChartVersion(session, version("VERSE fresh", V2));
    expect(next.draft.chart).toBe("VERSE fresh");
    expect(next.opening.chart).toBe("VERSE fresh");
    expect(next.baseUpdatedAt).toBe(V2);
    expect(next.conflict).toBeNull();
    expect(isDirty(next)).toBeFalsy();
  });

  it("holds unsaved edits in conflict with a newer version instead of saving over it", () => {
    const edited = typeChart(
      startChordChartSession(version("VERSE", V1), null),
      "VERSE mine"
    );
    const theirs = version("VERSE theirs", V2);
    const next = receiveChordChartVersion(edited, theirs);
    expect(next.draft.chart).toBe("VERSE mine");
    expect(next.conflict).toStrictEqual({ theirs });
    expect(savesAsYouType(next, typing)).toBeFalsy();
  });

  it("ignores the same or an older version, and anything while a save is out", () => {
    const session = startChordChartSession(version("VERSE", V2), null);
    expect(receiveChordChartVersion(session, version("VERSE", V2))).toBe(
      session
    );
    expect(receiveChordChartVersion(session, version("OLD", V1))).toBe(session);
    const saving = beginChordChartSave(typeChart(session, "A"), draft("A"));
    expect(receiveChordChartVersion(saving, version("A", V3))).toBe(saving);
  });

  it("takes the latest of several newer versions into an open conflict", () => {
    const conflicted = receiveChordChartVersion(
      typeChart(startChordChartSession(version("VERSE", V1), null), "mine"),
      version("theirs", V2)
    );
    const later = version("theirs again", V3);
    expect(receiveChordChartVersion(conflicted, later).conflict).toStrictEqual({
      theirs: later,
    });
  });
});

describe("saving", () => {
  it("stops after a save even when Planning Center reformats the chart", () => {
    const edited = typeChart(
      startChordChartSession(version("VERSE", V1), null),
      "VERSE\n[G]Amazing  "
    );
    const request = chordChartSaveRequest(edited);
    expect(request).toStrictEqual({
      chordChart: "VERSE\n[G]Amazing  ",
      chordChartKey: "G",
      layout: {},
      baseUpdatedAt: V1,
    });
    const saved = chordChartSaveSucceeded(
      beginChordChartSave(edited, edited.draft),
      V2
    );
    // Planning Center answers with trimmed text at the new version.
    const echoed = receiveChordChartVersion(
      saved,
      version("VERSE\n[G]Amazing", V2)
    );
    expect(isDirty(echoed)).toBeFalsy();
    expect(chordChartSaveStatus(echoed)).toBe("saved");
    expect(savesAsYouType(echoed, typing)).toBeFalsy();
  });

  it("keeps typing that happened during a save as unsaved", () => {
    const edited = typeChart(
      startChordChartSession(version("VERSE", V1), null),
      "A"
    );
    const saving = beginChordChartSave(edited, edited.draft);
    expect(chordChartSaveStatus(saving)).toBe("saving");
    const saved = chordChartSaveSucceeded(typeChart(saving, "AB"), V2);
    expect(chordChartSaveStatus(saved)).toBe("unsaved");
    expect(chordChartSaveRequest(saved).baseUpdatedAt).toBe(V2);
  });

  it("pauses after a failed save until the person saves by hand", () => {
    const edited = typeChart(
      startChordChartSession(version("VERSE", V1), null),
      "A"
    );
    const failed = chordChartSaveFailed(
      beginChordChartSave(edited, edited.draft),
      false
    );
    expect(savesAsYouType(typeChart(failed, "AB"), typing)).toBeFalsy();
    expect(canSaveChordChart(failed)).toBeTruthy();
    expect(failed.conflict).toBeNull();
  });

  it("waits for edits, the setting, permission, and no held dialog", () => {
    const edited = typeChart(
      startChordChartSession(version("VERSE", V1), null),
      "A"
    );
    expect(savesAsYouType(edited, typing)).toBeTruthy();
    expect(savesAsYouType(edited, { ...typing, enabled: false })).toBeFalsy();
    expect(savesAsYouType(edited, { ...typing, held: true })).toBeFalsy();
  });
});

describe("conflicts", () => {
  const refused = () => {
    const edited = typeChart(
      startChordChartSession(version("VERSE", V1), null),
      "VERSE mine"
    );
    return chordChartSaveFailed(
      beginChordChartSave(edited, edited.draft),
      true
    );
  };

  it("opens a conflict when Planning Center refuses a stale save", () => {
    const session = refused();
    expect(session.conflict).toStrictEqual({ theirs: null });
    expect(canSaveChordChart(session)).toBeFalsy();
    const theirs = version("VERSE theirs", V2);
    expect(receiveConflictVersion(session, theirs).conflict).toStrictEqual({
      theirs,
    });
  });

  it("keeps mine by saving the current text over their version, still checked", () => {
    const withTheirs = receiveConflictVersion(
      refused(),
      version("VERSE theirs", V2)
    );
    const kept = keepMyChordChart(typeChart(withTheirs, "VERSE mine, later"));
    expect(kept.conflict).toBeNull();
    expect(canSaveChordChart(kept)).toBeTruthy();
    expect(chordChartSaveRequest(kept)).toMatchObject({
      chordChart: "VERSE mine, later",
      baseUpdatedAt: V2,
    });
  });

  it("can't keep mine or use theirs before their version is known", () => {
    const session = refused();
    expect(keepMyChordChart(session)).toBe(session);
    expect(adoptTheirChordChart(session)).toBe(session);
  });

  it("uses theirs by dropping this editor's edits", () => {
    const theirs = version("VERSE theirs", V2);
    const adopted = adoptTheirChordChart(
      receiveConflictVersion(refused(), theirs)
    );
    expect(adopted.draft).toStrictEqual(theirs.draft);
    expect(adopted.opening).toStrictEqual(theirs.draft);
    expect(adopted.baseUpdatedAt).toBe(V2);
    expect(adopted.conflict).toBeNull();
    expect(isDirty(adopted)).toBeFalsy();
  });

  it("stores a conflict so a reload opens it again", () => {
    const conflicted = receiveChordChartVersion(
      typeChart(startChordChartSession(version("VERSE", V1), null), "mine"),
      version("theirs", V2)
    );
    const stored = storedChordChartSession(conflicted, NOW);
    expect(stored).toMatchObject({ baseUpdatedAt: V1 });
    const reopened = startChordChartSession(version("theirs", V2), stored);
    expect(reopened.draft.chart).toBe("mine");
    expect(reopened.conflict).not.toBeNull();
  });
});

describe(storedChordChartSession, () => {
  it("keeps nothing for an untouched chart", () => {
    const session = startChordChartSession(version("VERSE", V1), null);
    expect(storedChordChartSession(session, NOW)).toBeNull();
  });

  it("keeps where editing began after the edits are saved, for Revert", () => {
    const edited = typeChart(
      startChordChartSession(version("VERSE", V1), null),
      "CHORUS"
    );
    const saved = chordChartSaveSucceeded(
      beginChordChartSave(edited, edited.draft),
      V2
    );
    expect(storedChordChartSession(saved, NOW)).toStrictEqual({
      savedAt: NOW,
      baseUpdatedAt: V2,
      draft: null,
      opening: draft("VERSE"),
    });
    const reverted = revertChordChart(saved);
    expect(reverted.draft.chart).toBe("VERSE");
    expect(savesAsYouType(reverted, typing)).toBeTruthy();
  });
});

describe(changedLayout, () => {
  it("sends nothing when the layout is unchanged, so defaults stay inherited", () => {
    expect(changedLayout({ ...layout }, layout)).toStrictEqual({});
  });

  it("sends only the settings the draft changed, including resets", () => {
    expect(
      changedLayout({ ...layout, fontSize: 16, font: null }, layout)
    ).toStrictEqual({ font: null, fontSize: 16 });
  });
});

describe(chordChartCopy, () => {
  it("copies the chart and only print settings changed since editing began", () => {
    const session = startChordChartSession(version("VERSE", V1), null);
    const edited = editChordChartDraft(session, (current) => ({
      ...current,
      chart: "CHORUS",
      layout: { ...current.layout, columns: 1 },
    }));
    const saved = chordChartSaveSucceeded(
      beginChordChartSave(edited, edited.draft),
      V2
    );
    expect(chordChartCopy(saved)).toStrictEqual({
      chart: "CHORUS",
      key: "G",
      layout: { columns: 1 },
    });
  });
});

describe(importIntoChordChart, () => {
  it("replaces the chart and takes the import's key only when it names one", () => {
    expect(
      importIntoChordChart(draft("OLD"), { chart: "NEW", key: null }, "replace")
    ).toStrictEqual(draft("NEW"));
    expect(
      importIntoChordChart(draft("OLD"), { chart: "NEW", key: "Gb" }, "replace")
    ).toStrictEqual(draft("NEW", "Gb"));
  });

  it("appends after a blank line, or stands alone in an empty chart", () => {
    expect(
      importIntoChordChart(draft("A\n\n"), { chart: "B", key: "D" }, "append")
    ).toStrictEqual(draft("A\n\nB"));
    expect(
      importIntoChordChart(draft("  \n"), { chart: "B", key: null }, "append")
    ).toStrictEqual(draft("B"));
  });
});

describe(transposeChordChartDraft, () => {
  it("rewrites chords and the written key, and leaves a keyless chart alone", () => {
    expect(transposeChordChartDraft(draft("[G]Grace"), "A")).toStrictEqual(
      draft("[A]Grace", "A")
    );
    const keyless = draft("[G]Grace", null);
    expect(transposeChordChartDraft(keyless, "A")).toBe(keyless);
  });
});

describe(isNewerVersion, () => {
  it("compares Planning Center timestamps as times", () => {
    expect(isNewerVersion(V2, V1)).toBeTruthy();
    expect(isNewerVersion(V1, V2)).toBeFalsy();
    expect(isNewerVersion(V1, V1)).toBeFalsy();
    expect(isNewerVersion(V1, null)).toBeTruthy();
    expect(isNewerVersion(null, V1)).toBeFalsy();
  });
});
