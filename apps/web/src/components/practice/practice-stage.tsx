import type { ChordChartArrangement } from "@pcobooster/contracts/http/chord-charts";
import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import { parseKey } from "@pcobooster/planning-center-models/chord-chart-chords";
import {
  chartSections,
  lyricsOnly,
  readChart,
  sectionCode,
  sequenceSections,
} from "@pcobooster/planning-center-models/chord-chart-lines";
import { formatDuration } from "@pcobooster/planning-center-models/plan-overview";
import type { PlanItem } from "@pcobooster/planning-center-models/types";
import { useQuery } from "@tanstack/react-query";
import { FileMusic } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { PracticeChart } from "@/components/practice/practice-chart";
import {
  CapoMenu,
  FilesMenu,
  KeyMenu,
  TextSizeControl,
} from "@/components/practice/practice-controls";
import { PracticePlayer } from "@/components/practice/practice-player";
import { PlanFileViewer } from "@/components/schedule/plan-file-viewer";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createChordChartSongQueryOptions } from "@/hooks/use-chord-chart-song";
import { useFeatureEnabled } from "@/hooks/use-feature-enabled";
import { usePracticePrefs } from "@/hooks/use-practice-prefs";
import {
  NO_SONG_PRACTICE,
  playedSequence,
  practiceFiles,
  stepTextSize,
  withSongPractice,
} from "@/lib/practice";
import type { ChartMode, PracticeFiles, SongPractice } from "@/lib/practice";

/** How long a section jumped to stays marked. */
const JUMP_HIGHLIGHT_MS = 1200;

/** What the stage shows: the text chart in a mode, or one of the item's files. */
type Source = ChartMode | `file:${string}`;

const fileSource = (file: PlanFile): Source => `file:${file.id}`;

/** The arrangement's Lyrics & Chords text, read through the Songs API, when the song has one. */
const useArrangementChart = (item: PlanItem) => {
  const enabled = useFeatureEnabled("chordCharts");
  const songId = item.song?.id ?? null;
  const query = useQuery({
    ...createChordChartSongQueryOptions(songId ?? ""),
    enabled: enabled && songId !== null,
  });
  const arrangement =
    query.data?.arrangements.find(
      (candidate) => candidate.id === item.arrangement?.id
    ) ?? null;
  const hasChart = arrangement !== null && arrangement.chordChart.trim() !== "";
  return {
    arrangement: hasChart ? arrangement : null,
    // Without access or a flag the stage falls back to the plan's chart files.
    loading: enabled && songId !== null && query.isPending,
  };
};

/** The source to start on: the text chart, else the first chart file, then a video. */
const defaultSource = (
  hasChart: boolean,
  mode: ChartMode,
  files: PracticeFiles
): Source | null => {
  if (hasChart) {
    return mode;
  }
  const first = files.charts[0] ?? files.videos[0];
  return first === undefined ? null : fileSource(first);
};

const allFiles = (files: PracticeFiles): readonly PlanFile[] => [
  ...files.charts,
  ...files.videos,
  ...files.other,
];

/** Jumps the chart to a section and marks it for a moment. */
const useSectionJump = () => {
  const sections = useRef(new Map<number, HTMLElement>());
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
      }
    },
    []
  );
  const sectionRef = (index: number) => (element: HTMLElement | null) => {
    if (element === null) {
      sections.current.delete(index);
    } else {
      sections.current.set(index, element);
    }
  };
  const jump = (index: number) => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    sections.current.get(index)?.scrollIntoView({
      block: "start",
      behavior: reduceMotion ? "auto" : "smooth",
    });
    setHighlighted(index);
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => {
      setHighlighted(null);
    }, JUMP_HIGHLIGHT_MS);
  };
  return { sectionRef, jump, highlighted };
};

/**
 * The song's order of sections. Entries the chart has a heading for jump to it; the rest read
 * as the roadmap only.
 */
const SequenceStrip = ({
  sequence,
  targets,
  onJump,
}: {
  sequence: readonly string[];
  targets: readonly number[];
  onJump: (index: number) => void;
}) => {
  if (sequence.length === 0) {
    return null;
  }
  return (
    <ol aria-label="Sequence" className="flex flex-wrap items-center gap-1">
      {sequence.map((label, position) => {
        const index = targets[position] ?? -1;
        const code = sectionCode(label);
        return (
          // Sequence entries repeat (a chorus several times); their place is their identity.
          <li key={`${label}-${String(position)}`}>
            {index === -1 ? (
              <span
                title={label}
                className="text-muted-foreground inline-flex h-6 min-w-6 items-center justify-center px-1 text-xs font-medium"
              >
                {code}
              </span>
            ) : (
              <Button
                variant="secondary"
                size="xs"
                className="min-w-7"
                aria-label={`Jump to ${label}`}
                onClick={() => {
                  onJump(index);
                }}
              >
                {code}
              </Button>
            )}
          </li>
        );
      })}
    </ol>
  );
};

const ChartSkeleton = () => (
  <div className="flex flex-col gap-3 py-2" aria-hidden>
    <Skeleton variant="text" className="h-3 w-20" />
    <Skeleton variant="text" className="h-4 w-64" />
    <Skeleton variant="text" className="h-4 w-56" />
    <Skeleton variant="text" className="h-4 w-60" />
    <Skeleton variant="text" className="mt-4 h-3 w-16" />
    <Skeleton variant="text" className="h-4 w-52" />
    <Skeleton variant="text" className="h-4 w-64" />
  </div>
);

const NothingToShow = ({ filesLoading }: { filesLoading: boolean }) =>
  filesLoading ? (
    <ChartSkeleton />
  ) : (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileMusic />
        </EmptyMedia>
        <EmptyTitle>No chart for this one</EmptyTitle>
        <EmptyDescription>
          Planning Center has no chord chart or chart file for it.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );

const songMeta = (item: PlanItem): string =>
  [
    item.song?.author,
    item.arrangement?.name,
    item.length === null ? null : formatDuration(item.length),
  ]
    .filter((part) => part !== undefined && part !== null && part !== "")
    .join(" · ");

/** The text chart in the key and capo set for this song, as chords or lyrics. */
const TextChart = ({
  arrangement,
  item,
  song,
  mode,
  textSize,
  jump,
}: {
  arrangement: ChordChartArrangement;
  item: PlanItem;
  song: SongPractice;
  mode: ChartMode;
  textSize: Parameters<typeof PracticeChart>[0]["textSize"];
  jump: ReturnType<typeof useSectionJump>;
}) => {
  const reading = readChart({
    chordChart: arrangement.chordChart,
    writtenKey: arrangement.chordChartKey,
    soundingKey: song.key ?? item.key?.startingKey ?? null,
    capo: song.capo,
  });
  const sections = chartSections(
    mode === "lyrics" ? lyricsOnly(reading.lines) : reading.lines
  );
  const sequence = playedSequence(item);
  return (
    <div className="flex flex-col gap-4">
      <SequenceStrip
        sequence={sequence}
        targets={sequenceSections(sections, sequence)}
        onJump={(index) => {
          jump.jump(index);
        }}
      />
      {reading.note === null || mode === "lyrics" ? null : (
        <p className="text-muted-foreground text-xs">{reading.note}</p>
      )}
      <PracticeChart
        sections={sections}
        textSize={textSize}
        highlighted={jump.highlighted}
        sectionRef={jump.sectionRef}
      />
    </div>
  );
};

/** The song's chord controls, shown only while the text chart is up in chords. */
const ChordControls = ({
  item,
  arrangement,
  song,
  onSong,
}: {
  item: PlanItem;
  arrangement: ChordChartArrangement;
  song: SongPractice;
  onSong: (song: SongPractice) => void;
}) => {
  const written = parseKey(arrangement.chordChartKey);
  const sounding =
    parseKey(song.key) ?? parseKey(item.key?.startingKey) ?? written;
  return (
    <>
      {sounding === null ? null : (
        <KeyMenu
          sounding={sounding}
          planKey={item.key?.startingKey ?? written?.name ?? null}
          chosen={song.key}
          onChoose={(key) => {
            onSong({ ...song, key });
          }}
        />
      )}
      <CapoMenu
        sounding={written === null ? null : sounding}
        capo={song.capo}
        onChoose={(capo) => {
          onSong({ ...song, capo });
        }}
      />
    </>
  );
};

/** The saved capo and key for the item's arrangement, and how to change them. */
const useSongPractice = (item: PlanItem) => {
  const [prefs, updatePrefs] = usePracticePrefs();
  const arrangementId = item.arrangement?.id ?? null;
  const saved = arrangementId === null ? undefined : prefs.songs[arrangementId];
  const setSong = (next: SongPractice) => {
    if (arrangementId !== null) {
      updatePrefs((current) => withSongPractice(current, arrangementId, next));
    }
  };
  return { prefs, updatePrefs, song: saved ?? NO_SONG_PRACTICE, setSong };
};

/** What the stage shows, starting from the text chart or the first file, until one is chosen. */
const useStageSource = (
  chart: { readonly hasChart: boolean; readonly loading: boolean },
  mode: ChartMode,
  files: PracticeFiles
) => {
  const [chosen, setChosen] = useState<Source | null>(null);
  // Until the text chart is known, nothing opens: a file opened meanwhile records a view.
  const fallback = chart.loading
    ? null
    : defaultSource(chart.hasChart, mode, files);
  const source = chosen ?? fallback;
  const { hasChart } = chart;
  const shownFile =
    source?.startsWith("file:") === true
      ? (allFiles(files).find((file) => fileSource(file) === source) ?? null)
      : null;
  const textMode: ChartMode | null =
    hasChart && (source === "chords" || source === "lyrics") ? source : null;
  return { source, chosen, setChosen, shownFile, textMode };
};

const ItemNotes = ({ notes }: { notes: string }) =>
  notes.trim() === "" ? null : (
    <section className="flex flex-col gap-1 pb-4">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        Notes
      </h3>
      <p className="text-sm whitespace-pre-line">{notes}</p>
    </section>
  );

const StageTitle = ({
  item,
  navigation,
}: {
  item: PlanItem;
  navigation: ReactNode;
}) => {
  const meta = songMeta(item);
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-xl font-semibold tracking-tight">
          {item.title}
        </h2>
        {meta === "" ? null : (
          <p className="text-muted-foreground truncate text-sm">{meta}</p>
        )}
      </div>
      {navigation}
    </div>
  );
};

/**
 * One item on the stage: its title and the song's details, the controls for how the chart
 * reads, the chart (or a chart file, lead sheet, or video), notes, and the player for its
 * recordings. It remounts for each item, so choices made for one song start fresh on the next.
 */
export const PracticeStage = ({
  serviceTypeId,
  planId,
  item,
  files,
  filesLoading,
  navigation,
}: {
  serviceTypeId: string;
  planId: string;
  item: PlanItem;
  files: readonly PlanFile[];
  filesLoading: boolean;
  /** Previous and next controls and the phone setlist button, beside the title. */
  navigation: ReactNode;
}) => {
  const { prefs, updatePrefs, song, setSong } = useSongPractice(item);
  const chart = useArrangementChart(item);
  const itemFiles = useMemo(() => practiceFiles(files, item), [files, item]);
  const stage = useStageSource(
    { hasChart: chart.arrangement !== null, loading: chart.loading },
    prefs.mode,
    itemFiles
  );
  const jump = useSectionJump();

  let body: ReactNode = <NothingToShow filesLoading={filesLoading} />;
  if (chart.loading && stage.chosen === null) {
    body = <ChartSkeleton />;
  } else if (stage.textMode !== null && chart.arrangement !== null) {
    body = (
      <TextChart
        arrangement={chart.arrangement}
        item={item}
        song={song}
        mode={stage.textMode}
        textSize={prefs.textSize}
        jump={jump}
      />
    );
  } else if (stage.shownFile !== null) {
    body = (
      <div className="bg-muted/40 -mx-(--page-gutter) flex min-h-[70dvh] flex-col md:mx-0 md:min-h-0 md:flex-1 md:rounded-xl">
        <PlanFileViewer
          key={stage.shownFile.id}
          serviceTypeId={serviceTypeId}
          planId={planId}
          file={stage.shownFile}
        />
      </div>
    );
  }

  return (
    <Tabs
      value={stage.source ?? "none"}
      onValueChange={(value: string) => {
        if (value === "chords" || value === "lyrics") {
          stage.setChosen(value);
          updatePrefs((current) => ({ ...current, mode: value }));
        }
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex flex-col gap-3 pb-1">
        <StageTitle item={item} navigation={navigation} />
        <div className="-mx-2 flex flex-wrap items-center gap-1">
          {chart.arrangement === null ? null : (
            <TabsList className="mx-1">
              <TabsTrigger value="chords">Chords</TabsTrigger>
              <TabsTrigger value="lyrics">Lyrics</TabsTrigger>
            </TabsList>
          )}
          {stage.textMode === "chords" && chart.arrangement !== null ? (
            <ChordControls
              item={item}
              arrangement={chart.arrangement}
              song={song}
              onSong={setSong}
            />
          ) : null}
          {stage.textMode === null ? null : (
            <TextSizeControl
              size={prefs.textSize}
              onStep={(step) => {
                updatePrefs((current) => ({
                  ...current,
                  textSize: stepTextSize(current.textSize, step),
                }));
              }}
            />
          )}
          <span className="flex-1" />
          <FilesMenu
            files={itemFiles}
            selected={stage.shownFile}
            onChoose={(file) => {
              stage.setChosen(fileSource(file));
            }}
          />
        </div>
      </header>
      <TabsContent
        value={stage.source ?? "none"}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-6 md:overflow-y-auto md:overscroll-contain">
          {body}
          <ItemNotes notes={item.description} />
        </div>
      </TabsContent>
      {itemFiles.tracks.length > 0 ? (
        <PracticePlayer
          serviceTypeId={serviceTypeId}
          planId={planId}
          songTitle={item.title}
          tracks={itemFiles.tracks}
        />
      ) : null}
    </Tabs>
  );
};
