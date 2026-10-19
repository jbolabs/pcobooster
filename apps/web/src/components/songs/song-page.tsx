import type {
  ChordChartArrangement,
  ChordChartSong,
} from "@pcobooster/contracts/http/chord-charts";
import type { SongHistoryEntry } from "@pcobooster/contracts/http/songs";
import {
  arrangementFacts,
  chartActionLabel,
  historyDateLabel,
  historyNamesArrangements,
  historyRowDetail,
  keyEndingLabel,
  planningCenterArrangementUrl,
  planningCenterSongUrl,
  serviceTypeLabel,
  songCreditParts,
  songFacts,
  songFileGroups,
  songNotes,
  splitSongHistory,
} from "@pcobooster/planning-center-models/song-detail";
import type {
  SongNote,
  SongPageSearch,
} from "@pcobooster/planning-center-models/song-detail";
import type { KeyOption } from "@pcobooster/planning-center-models/types";
import { Link } from "@tanstack/react-router";
import {
  AudioLines,
  Clapperboard,
  ExternalLink,
  File,
  FileMusic,
  FileText,
  Image,
  Link2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { PageShell } from "@/components/page-shell";
import {
  ArrangementPicker,
  KeyTabs,
  useSongSelection,
} from "@/components/songs/song-arrangement-controls";
import { SongLoadError } from "@/components/songs/song-load-error";
import {
  SongPageHeader,
  SongPageHeaderSkeleton,
} from "@/components/songs/song-page-header";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Item, ItemMedia } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { useChordChartSong } from "@/hooks/use-chord-chart-song";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import {
  useOpenSongAttachment,
  useSongAttachments,
} from "@/hooks/use-song-attachments";
import type { SongAttachment } from "@/hooks/use-song-attachments";
import { useSongHistory } from "@/hooks/use-song-history";
import { rememberRecentSong } from "@/lib/recent-songs";

/** Plans ahead shown before "Show all". */
const UPCOMING_PREVIEW_ROWS = 3;
/** Past plans shown before "Show all". */
const PAST_PREVIEW_ROWS = 5;

/** A quiet sentence-case label over a section's rows. */
const SectionLabel = ({ children }: { children: ReactNode }) => (
  <h2 className="text-muted-foreground mb-1 text-xs font-medium">{children}</h2>
);

/** One line saying a section didn't load, with a way to try again. */
const SectionRetry = ({
  message,
  busy,
  onRetry,
}: {
  message: string;
  busy: boolean;
  onRetry: () => void;
}) => (
  <div className="text-muted-foreground flex items-center gap-3 text-sm">
    <span>{message}</span>
    <Button
      variant="outline"
      size="sm"
      touch="target"
      disabled={busy}
      onClick={onRetry}
    >
      Retry
    </Button>
  </div>
);

/** "Chart in G": the song's main action, to Planning Center's chart in the chosen key. */
const ChartLink = ({
  songId,
  arrangementId,
  chartKey,
  className,
}: {
  songId: string;
  arrangementId: string;
  chartKey: KeyOption | null;
  className: string;
}) => (
  <Link
    to="/songs/$songId/chart"
    params={{ songId }}
    search={{ arrangement: arrangementId, key: chartKey?.id }}
    className={buttonVariants({ size: "sm", className })}
  >
    <FileMusic aria-hidden />
    {chartActionLabel(chartKey)}
  </Link>
);

/** "4:13 · 70 bpm · 4/4", values in the text color and units muted. */
const FactsLine = ({
  arrangement,
  chartKey,
}: {
  arrangement: ChordChartArrangement;
  chartKey: KeyOption | null;
}) => {
  const facts = arrangementFacts(arrangement);
  // Shown here too, since the key tabs' hover never opens on touch or with a single key.
  const ending = chartKey === null ? null : keyEndingLabel(chartKey);
  if (facts.length === 0 && ending === null) {
    return null;
  }
  return (
    <p className="text-muted-foreground text-sm tabular-nums">
      {facts.map((fact, index) => (
        <span key={fact.label}>
          {index > 0 ? " · " : null}
          <span className="sr-only">{`${fact.label} `}</span>
          <span className="text-foreground">{fact.value}</span>
          {fact.unit === null ? null : ` ${fact.unit}`}
        </span>
      ))}
      {ending === null ? null : (
        <span>
          {facts.length > 0 ? " · " : null}
          {ending}
        </span>
      )}
    </p>
  );
};

/** The arrangement, its facts and sequence, the chart action, and its keys. */
const ArrangementSummary = ({
  songId,
  arrangement,
  arrangements,
  chartKey,
  onShow,
}: {
  songId: string;
  arrangement: ChordChartArrangement;
  arrangements: readonly ChordChartArrangement[];
  chartKey: KeyOption | null;
  onShow: (search: SongPageSearch) => void;
}) => (
  <section aria-label="Arrangement" className="flex flex-col gap-1">
    <div className="flex min-w-0 items-center gap-3">
      <ArrangementPicker
        arrangements={arrangements}
        arrangement={arrangement}
        onShow={onShow}
        flush
      />
      <ChartLink
        songId={songId}
        arrangementId={arrangement.id}
        chartKey={chartKey}
        className="shrink-0 max-md:hidden"
      />
    </div>
    <FactsLine arrangement={arrangement} chartKey={chartKey} />
    {arrangement.sequence.length === 0 ? null : (
      <ol aria-label="Sequence" className="flex flex-wrap gap-x-2 text-sm">
        {arrangement.sequence.map((section, index) => (
          // Sections repeat ("C" three times), so the position names each.
          // oxlint-disable-next-line react/no-array-index-key -- the sequence is fixed and positional
          <li key={`${index}-${section}`}>{section}</li>
        ))}
      </ol>
    )}
    <ChartLink
      songId={songId}
      arrangementId={arrangement.id}
      chartKey={chartKey}
      className="mt-2 h-11 w-full md:hidden"
    />
    <KeyTabs
      arrangement={arrangement}
      keyId={chartKey?.id ?? null}
      onShow={onShow}
    />
  </section>
);

const attachmentIcon: Record<SongAttachment["kind"], LucideIcon> = {
  pdf: FileText,
  image: Image,
  audio: AudioLines,
  video: Clapperboard,
  document: FileText,
  link: Link2,
  other: File,
};

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;

const fileSizeLabel = (bytes: number | null): string | null => {
  if (bytes === null || bytes <= 0) {
    return null;
  }
  if (bytes >= BYTES_PER_MB) {
    return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / BYTES_PER_KB))} KB`;
};

const attachmentName = (attachment: SongAttachment): string =>
  attachment.name || attachment.filename;

const AttachmentRowContent = ({
  attachment,
  note,
}: {
  attachment: SongAttachment;
  note: string | null;
}) => {
  const Icon = attachmentIcon[attachment.kind];
  const detail = note ?? fileSizeLabel(attachment.fileSize);
  return (
    <>
      <ItemMedia variant="icon">
        <Icon className="text-muted-foreground" aria-hidden />
      </ItemMedia>
      <span className="min-w-0 flex-1 truncate">
        {attachmentName(attachment)}
      </span>
      {detail === null ? null : (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {detail}
        </span>
      )}
    </>
  );
};

/** A link opens where it lives; a stored file opens from a fresh signed link. */
const AttachmentRow = ({
  songId,
  arrangementId,
  attachment,
  onOpen,
}: {
  songId: string;
  arrangementId: string;
  attachment: SongAttachment;
  onOpen: (attachment: SongAttachment) => Promise<void>;
}) => {
  if (attachment.kind === "link" && attachment.linkUrl !== null) {
    return (
      <Item
        size="row"
        render={
          <a
            href={attachment.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={attachmentName(attachment)}
          />
        }
      >
        <AttachmentRowContent attachment={attachment} note="Link" />
      </Item>
    );
  }
  if (!attachment.downloadable && !attachment.streamable) {
    // Licensed charts and the like: Planning Center shows them, this app can't.
    return (
      <Item
        size="row"
        render={
          <a
            href={planningCenterArrangementUrl(songId, arrangementId)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${attachmentName(attachment)}, in Planning Center`}
          />
        }
      >
        <AttachmentRowContent
          attachment={attachment}
          note="In Planning Center"
        />
      </Item>
    );
  }
  return (
    <Item
      size="row"
      render={<button type="button" aria-label={attachmentName(attachment)} />}
      onClick={() => {
        void onOpen(attachment);
      }}
    >
      <AttachmentRowContent attachment={attachment} note={null} />
    </Item>
  );
};

/** Files shown before "Show all", so notes and the schedule stay near. */
const FILE_PREVIEW_ROWS = 8;

const FileList = ({
  files,
  renderFile,
}: {
  files: readonly SongAttachment[];
  renderFile: (attachment: SongAttachment) => ReactNode;
}) => {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? files : files.slice(0, FILE_PREVIEW_ROWS);
  return (
    <div className="flex min-w-0 flex-col items-start">
      <ul className="flex w-full min-w-0 flex-col">
        {shown.map((attachment) => (
          <li key={attachment.id}>{renderFile(attachment)}</li>
        ))}
      </ul>
      {files.length > FILE_PREVIEW_ROWS ? (
        <Button
          type="button"
          variant="link"
          size="xs"
          touch="target"
          onClick={() => {
            setShowAll((current) => !current);
          }}
        >
          {showAll ? "Show less" : `Show all ${files.length}`}
        </Button>
      ) : null}
    </div>
  );
};

const PlanningCenterLink = ({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
  >
    {children}
    <ExternalLink className="size-3" aria-hidden />
  </a>
);

/**
 * Files people uploaded to the arrangement and its keys (Planning Center's own chart renders
 * are the Chart action instead). With two or more keys, the key tabs pick whose files show.
 * Nothing to list takes no room.
 */
const FilesSection = ({
  songId,
  arrangement,
  chartKey,
}: {
  songId: string;
  arrangement: ChordChartArrangement;
  chartKey: KeyOption | null;
}) => {
  const files = useSongAttachments(songId, arrangement.id);
  const openAttachment = useOpenSongAttachment(songId, arrangement.id);
  if (files.data === undefined) {
    // Most arrangements have no files, so nothing holds room for them while they load.
    return files.isError ? (
      <section aria-label="Files">
        <SectionLabel>Files</SectionLabel>
        <SectionRetry
          message="Files didn’t load."
          busy={files.isFetching}
          onRetry={() => {
            void files.refetch();
          }}
        />
      </section>
    ) : null;
  }
  const groups = songFileGroups(
    files.data.attachments,
    arrangement.keys,
    chartKey?.id ?? null
  );
  if (groups.length === 0 && !files.data.truncated) {
    return null;
  }
  return (
    <section aria-label="Files">
      <SectionLabel>Files</SectionLabel>
      <div className="flex flex-col gap-2">
        {groups.map((group) => (
          <div
            key={group.id}
            className="flex flex-col md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:items-start md:gap-3"
          >
            <h3 className="text-muted-foreground px-1.5 text-xs md:px-0 md:pt-3">
              {group.label}
            </h3>
            <FileList
              files={group.files}
              renderFile={(attachment) => (
                <AttachmentRow
                  songId={songId}
                  arrangementId={arrangement.id}
                  attachment={attachment}
                  onOpen={openAttachment}
                />
              )}
            />
          </div>
        ))}
        {files.data.truncated ? (
          <p className="text-muted-foreground px-1.5 text-xs md:px-0">
            Some files aren&apos;t listed ·{" "}
            <PlanningCenterLink
              href={planningCenterArrangementUrl(songId, arrangement.id)}
            >
              Open in Planning Center
            </PlanningCenterLink>
          </p>
        ) : null}
      </div>
    </section>
  );
};

/** Reports whether `text` runs past its clamp, now and whenever its size changes. */
const observeOverflow = (
  text: HTMLElement,
  onOverflow: (overflows: boolean) => void
): (() => void) => {
  const observer = new ResizeObserver(() => {
    onOverflow(text.scrollHeight > text.clientHeight + 1);
  });
  observer.observe(text);
  return () => {
    observer.disconnect();
  };
};

/** A note clamped to four lines, with "More" when it runs longer. */
const NoteText = ({ note }: { note: SongNote }) => {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  // Measured again whenever the width changes, such as a phone turning.
  useLayoutEffect(() => {
    const text = textRef.current;
    return text === null || expanded
      ? undefined
      : observeOverflow(text, setOverflows);
  }, [expanded]);
  return (
    <div className="flex flex-col items-start">
      <p
        ref={textRef}
        className={
          expanded
            ? "text-sm wrap-anywhere whitespace-pre-wrap"
            : "line-clamp-4 text-sm wrap-anywhere whitespace-pre-wrap"
        }
      >
        {note.text}
      </p>
      {overflows || expanded ? (
        <Button
          variant="link"
          size="xs"
          touch="target"
          className="-ml-2.5"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((current) => !current);
          }}
        >
          {expanded ? "Less" : "More"}
        </Button>
      ) : null}
    </div>
  );
};

/** The arrangement's notes (band directions), then the song's; only when there are some. */
const NotesSection = ({
  arrangement,
  song,
}: {
  arrangement: ChordChartArrangement;
  song: ChordChartSong;
}) => {
  const notes = songNotes(arrangement, song);
  if (notes.length === 0) {
    return null;
  }
  return (
    <section aria-label="Notes">
      <SectionLabel>Notes</SectionLabel>
      <div className="flex flex-col gap-3">
        {notes.map((note) => (
          // Keyed by the text too, so new text is measured afresh.
          <div
            key={`${note.source}-${note.text}`}
            className="flex flex-col gap-0.5"
          >
            {notes.length > 1 ? (
              <h3 className="text-muted-foreground text-xs">{note.source}</h3>
            ) : null}
            <NoteText note={note} />
          </div>
        ))}
      </div>
    </section>
  );
};

/** A song without arrangements: one line, and Planning Center to add one. */
const NoArrangements = ({ songId }: { songId: string }) => (
  <p className="text-muted-foreground text-sm">
    No arrangements yet ·{" "}
    <PlanningCenterLink href={planningCenterSongUrl(songId)}>
      Open in Planning Center
    </PlanningCenterLink>
  </p>
);

const MainColumnSkeleton = () => (
  <div
    className="flex flex-col gap-2"
    aria-busy
    aria-label="Loading arrangement"
  >
    <Skeleton variant="text" className="h-5 w-48" />
    <Skeleton variant="text" className="h-3.5 w-32" />
    <Skeleton variant="control" className="mt-2 h-11 w-full md:hidden" />
  </div>
);

const ScheduleRow = ({
  entry,
  detail,
  now,
  timeZone,
}: {
  entry: SongHistoryEntry;
  detail: string | null;
  now: Date;
  timeZone: string;
}) => {
  const content = (
    <>
      <span className="w-24 shrink-0 tabular-nums">
        {historyDateLabel(entry.sortDate, now, timeZone)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          {serviceTypeLabel(entry.serviceTypeName)}
        </span>
        {detail === null ? null : (
          // The arrangement (when the history spans several) gets its own line, so it shows.
          <span className="text-muted-foreground block truncate text-xs">
            {detail}
          </span>
        )}
      </span>
      <span className="text-muted-foreground shrink-0 text-xs">
        {entry.startingKey ?? ""}
      </span>
    </>
  );
  if (entry.planId === null || entry.serviceTypeId === null) {
    return <Item size="row">{content}</Item>;
  }
  return (
    <Item
      size="row"
      render={
        <Link
          to="/services/$serviceTypeId/plans/$planId/$view"
          params={{
            serviceTypeId: entry.serviceTypeId,
            planId: entry.planId,
            view: "plan",
          }}
        />
      }
    >
      {content}
    </Item>
  );
};

const scheduleRowKey = (entry: SongHistoryEntry) =>
  `${entry.planId ?? entry.serviceTypeName}-${entry.sortDate.toISOString()}`;

/** A capped list of plans with an inline "Show all N"; an empty one takes no room. */
const ScheduleList = ({
  label,
  entries,
  previewRows,
  namesArrangement,
  now,
  timeZone,
}: {
  label: string;
  entries: readonly SongHistoryEntry[];
  previewRows: number;
  namesArrangement: boolean;
  now: Date;
  timeZone: string;
}) => {
  const [showAll, setShowAll] = useState(false);
  if (entries.length === 0) {
    return null;
  }
  const shown = showAll ? entries : entries.slice(0, previewRows);
  return (
    <section aria-label={label}>
      <SectionLabel>{label}</SectionLabel>
      <ul className="-mx-1.5 flex flex-col">
        {shown.map((entry) => (
          <li key={scheduleRowKey(entry)}>
            <ScheduleRow
              entry={entry}
              detail={historyRowDetail(entry, namesArrangement)}
              now={now}
              timeZone={timeZone}
            />
          </li>
        ))}
      </ul>
      {entries.length > previewRows ? (
        <Button
          type="button"
          variant="link"
          size="xs"
          touch="target"
          className="-ml-2.5"
          onClick={() => {
            setShowAll((current) => !current);
          }}
        >
          {showAll ? "Show less" : `Show all ${entries.length}`}
        </Button>
      ) : null}
    </section>
  );
};

const SUMMARY_SKELETON_ROWS = ["last", "next", "year"];

const RailSkeleton = () => (
  <div className="flex flex-col gap-2" aria-busy aria-label="Loading history">
    {SUMMARY_SKELETON_ROWS.map((row) => (
      <div key={row} className="flex items-center gap-3">
        <Skeleton variant="text" className="h-3.5 w-16" />
        <Skeleton variant="text" className="h-3.5 w-28" />
      </div>
    ))}
  </div>
);

/**
 * When the song was last and next sung and how often in the past year, then the plans
 * themselves. One history read feeds it all, so one Retry covers it.
 */
const ScheduleRail = ({ songId, now }: { songId: string; now: Date }) => {
  const history = useSongHistory(songId);
  const timeZone = useOrganizationTimeZone();
  if (history.data === undefined) {
    return history.isError ? (
      <SectionRetry
        message="History didn’t load."
        busy={history.isFetching}
        onRetry={() => {
          void history.refetch();
        }}
      />
    ) : (
      <RailSkeleton />
    );
  }
  const { entries, truncated } = history.data;
  const { upcoming, past } = splitSongHistory(entries, now);
  const namesArrangement = historyNamesArrangements(entries);
  return (
    <>
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        {songFacts(entries, now, timeZone, truncated).map((fact) => (
          <div key={fact.label} className="contents">
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd className="min-w-0">
              <span className="tabular-nums" aria-hidden>
                {fact.value}
              </span>
              <span className="sr-only">{fact.accessibilityValue}</span>
              {fact.caption === null ? null : (
                <span className="text-muted-foreground block truncate text-xs">
                  {fact.caption}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <ScheduleList
        label="Upcoming"
        entries={upcoming}
        previewRows={UPCOMING_PREVIEW_ROWS}
        namesArrangement={namesArrangement}
        now={now}
        timeZone={timeZone}
      />
      <ScheduleList
        label="Past year"
        entries={past}
        previewRows={PAST_PREVIEW_ROWS}
        namesArrangement={namesArrangement}
        now={now}
        timeZone={timeZone}
      />
    </>
  );
};

/** Music on the left (on phones, first); the schedule in a rail from wide screens up. */
const SongPageLayout = ({
  main,
  rail,
}: {
  main: ReactNode;
  rail: ReactNode;
}) => (
  <div className="grid grid-cols-1 items-start gap-x-10 gap-y-8 @5xl:grid-cols-[minmax(0,42rem)_18rem]">
    <div className="flex min-w-0 flex-col gap-6">{main}</div>
    <aside aria-label="Schedule" className="flex min-w-0 flex-col gap-5">
      {rail}
    </aside>
  </div>
);

export const SongPageSkeleton = () => (
  <PageShell label="Loading song" busy>
    <SongPageHeaderSkeleton />
    <SongPageLayout main={<MainColumnSkeleton />} rail={<RailSkeleton />} />
  </PageShell>
);

/**
 * A song as Planning Center has it: the arrangement and its chart, files, and notes, then when
 * it was sung and where. Facts only; nothing here ranks or suggests a song.
 */
export const SongPage = ({
  songId,
  search,
}: {
  songId: string;
  search: SongPageSearch;
}) => {
  const chart = useChordChartSong(songId);
  const { selection, show } = useSongSelection(
    songId,
    "/songs/$songId",
    chart.data?.arrangements,
    search
  );
  // One "now" per visit, so "last" and "next" don't move under the reader.
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    if (chart.data !== undefined) {
      rememberRecentSong(chart.data.song);
    }
  }, [chart.data]);

  if (chart.data === undefined && chart.error !== null) {
    return (
      <SongLoadError
        error={chart.error}
        onRetry={() => {
          void chart.refetch();
        }}
      />
    );
  }

  const song = chart.data?.song ?? null;
  const arrangement = selection?.arrangement ?? null;
  let main: ReactNode = <MainColumnSkeleton />;
  if (song !== null && selection !== null) {
    main =
      arrangement === null ? (
        <NoArrangements songId={songId} />
      ) : (
        <>
          <ArrangementSummary
            songId={songId}
            arrangement={arrangement}
            arrangements={selection.arrangements}
            chartKey={selection.key}
            onShow={show}
          />
          <FilesSection
            key={arrangement.id}
            songId={songId}
            arrangement={arrangement}
            chartKey={selection.key}
          />
          <NotesSection arrangement={arrangement} song={song} />
        </>
      );
  }

  return (
    <PageShell>
      <SongPageHeader
        songId={songId}
        title={song?.title ?? null}
        credits={song === null ? [] : songCreditParts(song)}
      />
      <SongPageLayout
        main={main}
        rail={<ScheduleRail songId={songId} now={now} />}
      />
    </PageShell>
  );
};
