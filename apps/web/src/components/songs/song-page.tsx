import type {
  ChordChartArrangement,
  ChordChartSong,
} from "@pcobooster/contracts/http/chord-charts";
import type { SongHistoryEntry } from "@pcobooster/contracts/http/songs";
import {
  arrangementDisplayName,
  chartActionLabel,
  formatLength,
  historyDateLabel,
  historyNamesArrangements,
  historyRowDetail,
  keyEndingLabel,
  keyLabel,
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
  ArrangementNav,
  KeyTabs,
  useSongSelection,
} from "@/components/songs/song-arrangement-controls";
import { SongLoadError } from "@/components/songs/song-load-error";
import {
  SongPageHeader,
  SongPageHeaderSkeleton,
} from "@/components/songs/song-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Item, ItemMedia } from "@/components/ui/item";
import {
  Panel,
  PanelBody,
  PanelEmpty,
  PanelHeader,
  PanelMeta,
  PanelRows,
  PanelTitle,
} from "@/components/ui/panel";
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

/** A titled part of the page (Files, Schedule, Notes) over its panels. */
const PageSection = ({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) => (
  <section aria-label={label} className="flex min-w-0 flex-col gap-2">
    <div className="flex min-h-8 items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">{label}</h2>
      {action}
    </div>
    {children}
  </section>
);

/** One of the arrangement's numbers; one Planning Center doesn't set says so, quietly. */
const StatTile = ({
  label,
  value,
  caption = null,
}: {
  label: string;
  value: string | null;
  caption?: string | null;
}) => (
  <div className="border-border/40 bg-card/30 flex min-w-0 flex-col rounded-xl border px-3 py-2">
    <dt className="text-muted-foreground text-xs">{label}</dt>
    <dd className="min-w-0">
      {value === null ? (
        <span className="text-muted-foreground block py-0.5 text-sm">
          Not set
        </span>
      ) : (
        <span className="block truncate text-lg font-semibold tracking-tight tabular-nums">
          {value}
        </span>
      )}
      {caption === null ? null : (
        <span className="text-muted-foreground block truncate text-xs">
          {caption}
        </span>
      )}
    </dd>
  </div>
);

/** Key, tempo, meter, and length, always all four, so arrangements read the same way. */
const ArrangementStats = ({
  arrangement,
  chartKey,
}: {
  arrangement: ChordChartArrangement;
  chartKey: KeyOption | null;
}) => {
  const meter = arrangement.meter?.trim() ?? "";
  return (
    <dl className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
      <StatTile
        label="Key"
        value={chartKey === null ? null : keyLabel(chartKey)}
        caption={chartKey === null ? null : keyEndingLabel(chartKey)}
      />
      <StatTile
        label="Tempo"
        value={
          arrangement.bpm === null || arrangement.bpm <= 0
            ? null
            : `${arrangement.bpm} bpm`
        }
      />
      <StatTile label="Meter" value={meter === "" ? null : meter} />
      <StatTile
        label="Length"
        value={
          arrangement.length === null ? null : formatLength(arrangement.length)
        }
      />
    </dl>
  );
};

/** The arrangement's name, its chart, its numbers, and its sequence. */
const ArrangementSummary = ({
  songId,
  arrangement,
  chartKey,
}: {
  songId: string;
  arrangement: ChordChartArrangement;
  chartKey: KeyOption | null;
}) => (
  <section aria-label="Arrangement" className="flex min-w-0 flex-col gap-3">
    <div className="flex min-w-0 items-center justify-between gap-3">
      <h2 className="min-w-0 text-lg font-semibold tracking-tight wrap-break-word">
        {arrangementDisplayName(arrangement.name)}
        {arrangement.archived ? (
          <span className="text-muted-foreground text-sm font-normal">
            {" "}
            · Archived
          </span>
        ) : null}
      </h2>
      <ChartLink
        songId={songId}
        arrangementId={arrangement.id}
        chartKey={chartKey}
        className="shrink-0 max-md:hidden"
      />
    </div>
    <ArrangementStats arrangement={arrangement} chartKey={chartKey} />
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="text-muted-foreground text-xs">Sequence</span>
      {arrangement.sequence.length === 0 ? (
        <span className="text-muted-foreground text-sm">None yet</span>
      ) : (
        <ol aria-label="Sequence" className="flex flex-wrap gap-1">
          {arrangement.sequence.map((section, index) => (
            // Sections repeat ("C" three times), so the position names each.
            // oxlint-disable-next-line react/no-array-index-key, react-doctor/no-array-index-as-key -- the sequence is fixed and positional
            <li key={`${index}-${section}`}>
              <Badge variant="secondary">{section}</Badge>
            </li>
          ))}
        </ol>
      )}
    </div>
    <ChartLink
      songId={songId}
      arrangementId={arrangement.id}
      chartKey={chartKey}
      className="h-11 w-full md:hidden"
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
  const Icon =
    attachment.chart === undefined
      ? attachmentIcon[attachment.kind]
      : FileMusic;
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

/**
 * A key's chord chart opens the chart page in that key; a link opens where it lives; a stored
 * file (Planning Center's lyrics sheet included) opens from a fresh signed link.
 */
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
  if (attachment.chart === "chord" && attachment.keyId !== null) {
    // Planning Center's chord chart for a key: the chart page shows it, in that key.
    return (
      <Item
        size="row"
        render={
          <Link
            to="/songs/$songId/chart"
            params={{ songId }}
            search={{ arrangement: arrangementId, key: attachment.keyId }}
            aria-label={attachmentName(attachment)}
          />
        }
      >
        <AttachmentRowContent attachment={attachment} note="Chart" />
      </Item>
    );
  }
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

/** A panel's quiet one line, for a section with nothing to list. */
const PanelMessage = ({ children }: { children: ReactNode }) => (
  <Panel render={<div />}>
    <PanelEmpty>{children}</PanelEmpty>
  </Panel>
);

const FilesSkeleton = () => (
  <Panel render={<div aria-busy aria-label="Loading files" />}>
    <PanelHeader>
      <Skeleton variant="text" className="mx-1.5 h-3.5 w-24" />
    </PanelHeader>
    <PanelBody>
      <PanelRows>
        <Skeleton variant="text" className="m-1.5 h-3.5 w-40" />
        <Skeleton variant="text" className="m-1.5 h-3.5 w-28" />
      </PanelRows>
    </PanelBody>
  </Panel>
);

/**
 * Files people uploaded to the arrangement and its keys, side by side as Planning Center lays
 * them out: the arrangement's own (every key), then the chosen key's. With two or more keys,
 * the key tabs pick whose files show. Planning Center's own chord chart and lyrics renders are
 * listed too, as Planning Center lists them.
 */
const FilesSection = ({
  songId,
  arrangement,
  chartKey,
  onShow,
}: {
  songId: string;
  arrangement: ChordChartArrangement;
  chartKey: KeyOption | null;
  onShow: (search: SongPageSearch) => void;
}) => {
  const files = useSongAttachments(songId, arrangement.id);
  const openAttachment = useOpenSongAttachment(songId, arrangement.id);
  let body: ReactNode = <FilesSkeleton />;
  if (files.data === undefined) {
    if (files.isError) {
      body = (
        <Panel render={<div />}>
          <PanelRows>
            <SectionRetry
              message="Files didn’t load."
              busy={files.isFetching}
              onRetry={() => {
                void files.refetch();
              }}
            />
          </PanelRows>
        </Panel>
      );
    }
  } else {
    const groups = songFileGroups(
      files.data.attachments,
      arrangement.keys,
      chartKey?.id ?? null
    );
    body =
      groups.length === 0 && !files.data.truncated ? (
        <PanelMessage>
          No files on this arrangement ·{" "}
          <PlanningCenterLink
            href={planningCenterArrangementUrl(songId, arrangement.id)}
          >
            Add in Planning Center
          </PlanningCenterLink>
        </PanelMessage>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 items-start gap-3 @3xl:grid-cols-2">
            {groups.map((group) => (
              <Panel key={group.id} aria-label={`${group.label} files`}>
                <PanelHeader>
                  <PanelTitle>{group.label}</PanelTitle>
                  <PanelMeta>
                    {group.id === "arrangement"
                      ? "Every key"
                      : `${group.files.length}`}
                  </PanelMeta>
                </PanelHeader>
                <PanelBody>
                  <PanelRows>
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
                  </PanelRows>
                </PanelBody>
              </Panel>
            ))}
          </div>
          {files.data.truncated ? (
            <p className="text-muted-foreground text-xs">
              Some files aren&apos;t listed ·{" "}
              <PlanningCenterLink
                href={planningCenterArrangementUrl(songId, arrangement.id)}
              >
                Open in Planning Center
              </PlanningCenterLink>
            </p>
          ) : null}
        </div>
      );
  }
  return (
    <PageSection
      label="Files"
      action={
        <KeyTabs
          arrangement={arrangement}
          keyId={chartKey?.id ?? null}
          onShow={onShow}
        />
      }
    >
      {body}
    </PageSection>
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

/** The arrangement's notes (band directions), then the song's. */
const NotesSection = ({
  arrangement,
  song,
}: {
  arrangement: ChordChartArrangement;
  song: ChordChartSong;
}) => {
  const notes = songNotes(arrangement, song);
  return (
    <PageSection label="Notes">
      {notes.length === 0 ? (
        <PanelMessage>No notes</PanelMessage>
      ) : (
        <div className="flex flex-col gap-3">
          {notes.map((note) => (
            // Keyed by the text too, so new text is measured afresh.
            <Panel
              key={`${note.source}-${note.text}`}
              aria-label={`${note.source} notes`}
            >
              <PanelHeader>
                <PanelTitle>{note.source}</PanelTitle>
              </PanelHeader>
              <PanelBody>
                <PanelRows>
                  <div className="px-1.5 py-1">
                    <NoteText note={note} />
                  </div>
                </PanelRows>
              </PanelBody>
            </Panel>
          ))}
        </div>
      )}
    </PageSection>
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

const STAT_SKELETONS = ["key", "tempo", "meter", "length"];

const MainColumnSkeleton = () => (
  <div
    className="flex flex-col gap-3"
    aria-busy
    aria-label="Loading arrangement"
  >
    <Skeleton variant="text" className="h-5 w-48" />
    <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
      {STAT_SKELETONS.map((stat) => (
        <Skeleton key={stat} variant="block" className="h-15" />
      ))}
    </div>
    <Skeleton variant="text" className="h-3.5 w-56" />
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
      {entry.startingKey === null ? null : (
        <Badge variant="outline">{entry.startingKey}</Badge>
      )}
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
    <Panel aria-label={label}>
      <PanelHeader>
        <PanelTitle>{label}</PanelTitle>
        <PanelMeta>{entries.length}</PanelMeta>
      </PanelHeader>
      <PanelBody>
        <PanelRows className="items-start">
          <ul className="flex w-full flex-col">
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
              onClick={() => {
                setShowAll((current) => !current);
              }}
            >
              {showAll ? "Show less" : `Show all ${entries.length}`}
            </Button>
          ) : null}
        </PanelRows>
      </PanelBody>
    </Panel>
  );
};

const SCHEDULE_SKELETONS = ["last", "next", "year"];

const ScheduleSkeleton = () => (
  <div className="flex flex-col gap-3" aria-busy aria-label="Loading history">
    <div className="grid grid-cols-3 gap-2">
      {SCHEDULE_SKELETONS.map((stat) => (
        <Skeleton key={stat} variant="block" className="h-15" />
      ))}
    </div>
    <Skeleton variant="text" className="h-3.5 w-40" />
    <Skeleton variant="text" className="h-3.5 w-32" />
  </div>
);

/**
 * When the song was last and next sung and how often in the past year, then the plans
 * themselves. One history read feeds it all, so one Retry covers it.
 */
const ScheduleSection = ({ songId, now }: { songId: string; now: Date }) => {
  const history = useSongHistory(songId);
  const timeZone = useOrganizationTimeZone();
  let body: ReactNode = <ScheduleSkeleton />;
  if (history.data === undefined) {
    if (history.isError) {
      body = (
        <SectionRetry
          message="History didn’t load."
          busy={history.isFetching}
          onRetry={() => {
            void history.refetch();
          }}
        />
      );
    }
  } else {
    const { entries, truncated } = history.data;
    const { upcoming, past } = splitSongHistory(entries, now);
    const namesArrangement = historyNamesArrangements(entries);
    body = (
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-3 gap-2">
          {songFacts(entries, now, timeZone, truncated).map((fact) => (
            <div
              key={fact.label}
              className="border-border/40 bg-card/30 flex min-w-0 flex-col rounded-xl border px-3 py-2"
            >
              <dt className="text-muted-foreground text-xs">{fact.label}</dt>
              <dd className="min-w-0">
                <span
                  className="block truncate text-sm font-semibold tabular-nums"
                  aria-hidden
                >
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
      </div>
    );
  }
  return <PageSection label="Schedule">{body}</PageSection>;
};

/**
 * Planning Center's layout: arrangements in a column beside the page (a sideways row on phones),
 * then the arrangement, its files, and the schedule and notes side by side.
 */
const SongPageLayout = ({
  nav,
  main,
  schedule,
  notes,
}: {
  nav: ReactNode;
  main: ReactNode;
  schedule: ReactNode;
  notes: ReactNode;
}) => (
  <div className="grid grid-cols-1 items-start gap-x-8 gap-y-5 @4xl:grid-cols-[13rem_minmax(0,1fr)]">
    <div className="min-w-0 @4xl:sticky @4xl:top-0">{nav}</div>
    <div className="flex min-w-0 flex-col gap-8">
      {main}
      <div className="grid grid-cols-1 items-start gap-8 @5xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {schedule}
        {notes}
      </div>
    </div>
  </div>
);

export const SongPageSkeleton = () => (
  <PageShell label="Loading song" busy>
    <SongPageHeaderSkeleton />
    <SongPageLayout
      nav={null}
      main={<MainColumnSkeleton />}
      schedule={
        <PageSection label="Schedule">
          <ScheduleSkeleton />
        </PageSection>
      }
      notes={null}
    />
  </PageShell>
);

/**
 * A song as Planning Center has it: its arrangements, then the chosen one's numbers, chart,
 * files, and notes, and when it was sung and where. Facts only; nothing here ranks or suggests
 * a song.
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
  let nav: ReactNode = null;
  let main: ReactNode = <MainColumnSkeleton />;
  let notes: ReactNode = null;
  if (song !== null && selection !== null) {
    if (arrangement === null) {
      main = <NoArrangements songId={songId} />;
    } else {
      nav = (
        <ArrangementNav
          arrangements={selection.arrangements}
          arrangement={arrangement}
          onShow={show}
        />
      );
      main = (
        <>
          <ArrangementSummary
            songId={songId}
            arrangement={arrangement}
            chartKey={selection.key}
          />
          <FilesSection
            key={arrangement.id}
            songId={songId}
            arrangement={arrangement}
            chartKey={selection.key}
            onShow={show}
          />
        </>
      );
      notes = <NotesSection arrangement={arrangement} song={song} />;
    }
  }

  return (
    <PageShell>
      <SongPageHeader
        songId={songId}
        title={song?.title ?? null}
        credits={song === null ? [] : songCreditParts(song)}
      />
      <SongPageLayout
        nav={nav}
        main={main}
        schedule={<ScheduleSection songId={songId} now={now} />}
        notes={notes}
      />
    </PageShell>
  );
};
