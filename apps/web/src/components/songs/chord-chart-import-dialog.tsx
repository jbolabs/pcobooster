import type {
  ChordChartArrangement,
  ChordChartSong,
  LyricsSearchResult,
} from "@pcobooster/contracts/http/chord-charts";
import { parseKey } from "@pcobooster/planning-center-models/chord-chart-chords";
import {
  importChordChart,
  lyricsToChordChart,
} from "@pcobooster/planning-center-models/chord-chart-import";
import type { ChordChartImportFormat } from "@pcobooster/planning-center-models/chord-chart-import";
import { useState } from "react";

import { LyricsSearchPanel } from "@/components/songs/lyrics-search-panel";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { ChordChartImportText } from "@/lib/chord-chart-session";
import { lyricsSearchQueryFor } from "@/lib/lyrics-search";

type ImportTab = "search" | "paste" | "arrangement";

const formatLabels: Record<ChordChartImportFormat, string> = {
  "chordpro-file": "ChordPro file, such as a SongSelect download",
  "chords-over-lyrics": "Chords written above lyrics",
  "inline-chords": "Chart with inline [chords]",
  lyrics: "Lyrics only",
};

const LYRICS_NOTE =
  "Verses are numbered and repeated stanzas become choruses. Rename sections as needed.";

/** Another arrangement's chart, or only its lyrics. */
type ArrangementSource = `chart:${string}` | `lyrics:${string}`;

const isArrangementSource = (value: string): value is ArrangementSource =>
  value.startsWith("chart:") || value.startsWith("lyrics:");

const isImportTab = (value: string): value is ImportTab =>
  value === "search" || value === "paste" || value === "arrangement";

/** What would land in the editor, and a line about how the text was read. */
interface ImportPreview {
  readonly text: ChordChartImportText;
  readonly note: string;
}

const fromLyrics = (lyrics: string): ImportPreview => ({
  text: { chart: lyricsToChordChart(lyrics), key: null },
  note: LYRICS_NOTE,
});

/** Another arrangement's chart arrives exactly as written there, codes and all. */
const fromArrangement = (
  source: ArrangementSource | null,
  arrangements: readonly ChordChartArrangement[]
): ImportPreview | null => {
  if (source === null) {
    return null;
  }
  const [kind, id] = source.split(":");
  const arrangement = arrangements.find((candidate) => candidate.id === id);
  if (arrangement === undefined) {
    return null;
  }
  if (kind === "lyrics") {
    return arrangement.lyrics.trim() === ""
      ? null
      : fromLyrics(arrangement.lyrics);
  }
  if (arrangement.chordChart.trim() === "") {
    return null;
  }
  const written =
    arrangement.chordChartKey === null
      ? ""
      : `, written in ${arrangement.chordChartKey}`;
  return {
    text: { chart: arrangement.chordChart, key: arrangement.chordChartKey },
    note: `An exact copy of the chart in “${arrangement.name}”${written}.`,
  };
};

const fromPasted = (pasted: string): ImportPreview | null => {
  if (pasted.trim() === "") {
    return null;
  }
  const result = importChordChart(pasted);
  return {
    text: {
      chart: result.chart,
      key: parseKey(result.metadata.key)?.name ?? null,
    },
    note: `Detected: ${formatLabels[result.format]}.`,
  };
};

interface ImportState {
  tab: ImportTab;
  pasted: string;
  found: LyricsSearchResult | null;
  arrangementSource: ArrangementSource | null;
}

const previewFor = (
  state: ImportState,
  arrangements: readonly ChordChartArrangement[]
): ImportPreview | null => {
  if (state.tab === "search") {
    return state.found === null ? null : fromLyrics(state.found.lyrics);
  }
  if (state.tab === "paste") {
    return fromPasted(state.pasted);
  }
  return fromArrangement(state.arrangementSource, arrangements);
};

const statusText = (
  state: ImportState,
  preview: ImportPreview | null
): string => {
  if (preview !== null) {
    return preview.note;
  }
  return state.tab === "search"
    ? "Lyrics come from LRCLIB, a free community database. Check them against the official lyrics and your CCLI license."
    : "Nothing to import yet.";
};

export interface ChordChartImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  song: ChordChartSong;
  /** This song's arrangements, offered as starting points. */
  arrangements: readonly ChordChartArrangement[];
  onImport: (text: ChordChartImportText, mode: "replace" | "append") => void;
}

/**
 * Starts a chart from lyrics found on the web, from text pasted from anywhere (SongSelect
 * ChordPro, a chord sheet, or lyrics) converted to Services' format, or from another
 * arrangement's chart copied as is.
 */
export const ChordChartImportDialog = ({
  open,
  onOpenChange,
  song,
  arrangements,
  onImport,
}: ChordChartImportDialogProps) => {
  const [state, setState] = useState<ImportState>({
    tab: "search",
    pasted: "",
    found: null,
    arrangementSource: null,
  });
  const preview = previewFor(state, arrangements);
  const update = (change: Partial<ImportState>) => {
    setState((current) => ({ ...current, ...change }));
  };

  const finish = (mode: "replace" | "append") => {
    if (preview === null) {
      return;
    }
    onImport(preview.text, mode);
    update({ pasted: "", found: null });
    onOpenChange(false);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl">
        <ResponsiveDialogHeader className="text-left">
          <ResponsiveDialogTitle>Import lyrics or chords</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Start from lyrics found online, paste a SongSelect ChordPro file or
            chord sheet, or copy another arrangement.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="flex min-h-0 flex-col gap-3 max-md:px-4">
          <Tabs
            value={state.tab}
            onValueChange={(value: string) => {
              if (isImportTab(value)) {
                update({ tab: value });
              }
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="search">Search lyrics</TabsTrigger>
              <TabsTrigger value="paste">Paste</TabsTrigger>
              <TabsTrigger
                value="arrangement"
                disabled={arrangements.length === 0}
              >
                Arrangement
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {state.tab === "search" ? (
            <LyricsSearchPanel
              initialQuery={lyricsSearchQueryFor(song.title, song.author)}
              selectedId={state.found?.id ?? null}
              onSelect={(found) => {
                update({ found });
              }}
            />
          ) : null}
          {state.tab === "paste" ? (
            <Textarea
              aria-label="Text to import"
              autoFocus
              // Chord names like Cmaj7 are not words to correct.
              autoCorrect="off"
              spellCheck={false}
              className="h-72"
              placeholder={
                "{title: Song}\n{comment: Verse 1}\n[G]Lyrics with [C]chords"
              }
              value={state.pasted}
              onChange={(event) => {
                update({ pasted: event.target.value });
              }}
            />
          ) : null}
          {state.tab === "arrangement" ? (
            <NativeSelect
              aria-label="Arrangement to copy"
              className="w-full"
              value={state.arrangementSource ?? ""}
              onChange={(event) => {
                const next = event.target.value;
                update({
                  arrangementSource: isArrangementSource(next) ? next : null,
                });
              }}
            >
              <NativeSelectOption value="">
                Choose an arrangement
              </NativeSelectOption>
              {arrangements.map((arrangement) => (
                <NativeSelectOption
                  key={`chart:${arrangement.id}`}
                  value={`chart:${arrangement.id}`}
                  disabled={arrangement.chordChart.trim() === ""}
                >
                  {`Chart from “${arrangement.name}”`}
                </NativeSelectOption>
              ))}
              {arrangements.map((arrangement) => (
                <NativeSelectOption
                  key={`lyrics:${arrangement.id}`}
                  value={`lyrics:${arrangement.id}`}
                  disabled={arrangement.lyrics.trim() === ""}
                >
                  {`Lyrics only from “${arrangement.name}”`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : null}
          {state.tab !== "paste" && preview !== null ? (
            <pre className="bg-muted/50 h-48 overflow-auto overscroll-contain rounded-2xl p-3 font-mono text-xs whitespace-pre-wrap">
              {preview.text.chart}
            </pre>
          ) : null}
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {statusText(state, preview)}
          </p>
        </div>
        <ResponsiveDialogFooter>
          <Button
            variant="outline"
            disabled={preview === null}
            onClick={() => {
              finish("append");
            }}
          >
            Add to end
          </Button>
          <Button
            disabled={preview === null}
            onClick={() => {
              finish("replace");
            }}
          >
            Replace chart
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
};
