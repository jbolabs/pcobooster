import type { SongHistoryEntry } from "@pcobooster/contracts/http/songs";
import {
  arrangementRows,
  formatLength,
  historyDateLabel,
  historyNamesArrangements,
  historyRowDetail,
  historyServiceTypeId,
  planningCenterArrangementUrl,
  serviceTypeLabel,
  songFacts,
  splitSongHistory,
} from "@pcobooster/planning-center-models/song-detail";
import type {
  ArrangementRowData,
  SongFact,
} from "@pcobooster/planning-center-models/song-detail";
import type {
  ArrangementOption,
  KeyOption,
} from "@pcobooster/planning-center-models/types";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AudioLines,
  CalendarDays,
  Clapperboard,
  ExternalLink,
  File,
  FileMusic,
  FileText,
  Image,
  Link2,
  ListMusic,
  Paperclip,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { SongLoadError } from "@/components/songs/song-load-error";
import { SongPageHeader } from "@/components/songs/song-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Item, ItemMedia } from "@/components/ui/item";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useChordChartSong } from "@/hooks/use-chord-chart-song";
import { useOrganizationTimeZone } from "@/hooks/use-organization-timezone";
import { useServiceTypes } from "@/hooks/use-service-types";
import {
  useOpenSongAttachment,
  useSongAttachments,
} from "@/hooks/use-song-attachments";
import type { SongAttachment } from "@/hooks/use-song-attachments";
import { useSongHistory } from "@/hooks/use-song-history";
import { useSongOptions } from "@/hooks/use-song-options";
import { rememberRecentSong } from "@/lib/recent-songs";

/** Past plans shown before "Show all". */
const HISTORY_PREVIEW_ROWS = 8;

const SectionTitle = ({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) => (
  <CardTitle>
    <span className="flex items-center gap-2">
      <Icon className="text-muted-foreground size-4" aria-hidden />
      {children}
    </span>
  </CardTitle>
);

/** "G", or "G · Jordan's key" when the key has its own name. */
const keyLabel = (key: KeyOption): string => {
  const name = key.name.trim();
  const start = key.startingKey ?? "";
  if (name === "" || name === start) {
    return start === "" ? "No key" : start;
  }
  return start === "" ? name : `${start} · ${name}`;
};

const FactTile = ({ fact }: { fact: SongFact }) => (
  <div className="border-border/40 rounded-lg border px-3 py-2">
    <p className="text-muted-foreground text-xs">{fact.label}</p>
    {fact.kind === "keys" ? (
      <p className="mt-1 text-sm font-semibold">
        {fact.keys.length === 0 ? "None yet" : fact.keys.join(", ")}
      </p>
    ) : (
      <>
        <p
          className="mt-1 text-sm font-semibold tabular-nums"
          aria-label={fact.accessibilityValue}
        >
          {fact.value}
        </p>
        {fact.caption === null ? null : (
          <p className="text-muted-foreground truncate text-xs">
            {fact.caption}
          </p>
        )}
      </>
    )}
  </div>
);

const FACT_SKELETON_KEYS = ["last", "next", "year", "keys"];

const SongFacts = ({
  history,
  now,
}: {
  history: readonly SongHistoryEntry[] | undefined;
  now: Date;
}) => {
  const timeZone = useOrganizationTimeZone();
  return (
    <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
      {history === undefined
        ? FACT_SKELETON_KEYS.map((key) => (
            <div
              key={key}
              className="border-border/40 rounded-lg border px-3 py-2"
            >
              <Skeleton variant="text" className="h-3 w-20" />
              <Skeleton variant="text" className="mt-2 h-4 w-12" />
            </div>
          ))
        : songFacts(history, now, timeZone).map((fact) => (
            <FactTile key={fact.label} fact={fact} />
          ))}
    </div>
  );
};

const DetailRow = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-3 py-1.5">
    <dt className="text-muted-foreground text-sm">{label}</dt>
    <dd className="text-sm">{children}</dd>
  </div>
);

const Unset = () => <span className="text-muted-foreground">Not set</span>;

/** Length, tempo, meter, sequence, and keys, as Planning Center has them. */
const ArrangementDetails = ({
  row,
  option,
  optionsLoading,
}: {
  row: ArrangementRowData;
  /** The arrangement from `songs.options`; the chart read lacks length, tempo, and meter. */
  option: ArrangementOption | undefined;
  optionsLoading: boolean;
}) => {
  const length =
    option === undefined || option.length === null
      ? null
      : formatLength(option.length);
  const bpm =
    option === undefined || option.bpm === null ? null : String(option.bpm);
  const pending = option === undefined && optionsLoading;
  const fact = (value: string | null) => {
    if (pending) {
      return <Skeleton variant="text" className="h-3.5 w-12" />;
    }
    return value ?? <Unset />;
  };
  return (
    <dl className="flex flex-col">
      <DetailRow label="Length">{fact(length)}</DetailRow>
      <DetailRow label="BPM">{fact(bpm)}</DetailRow>
      <DetailRow label="Meter">{fact(option?.meter ?? null)}</DetailRow>
      <DetailRow label="Sequence">
        {fact(row.sequence.length === 0 ? null : row.sequence.join(", "))}
      </DetailRow>
      <DetailRow label="Keys">
        {row.keys.length === 0 ? (
          <span className="text-muted-foreground">None</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.keys.map((key) => (
              <Badge key={key.id} variant="outline">
                {keyLabel(key)}
              </Badge>
            ))}
          </span>
        )}
      </DetailRow>
    </dl>
  );
};

const ArrangementCard = ({
  songId,
  rows,
  row,
  option,
  optionsLoading,
}: {
  songId: string;
  rows: readonly ArrangementRowData[];
  row: ArrangementRowData;
  option: ArrangementOption | undefined;
  optionsLoading: boolean;
}) => {
  const navigate = useNavigate();
  return (
    <Card size="sm">
      <CardHeader>
        <SectionTitle icon={ListMusic}>
          {rows.length > 1 ? "Arrangement" : row.name}
        </SectionTitle>
        {rows.length > 1 ? null : (
          <CardDescription>
            {row.archived ? "Archived arrangement" : "The only arrangement"}
          </CardDescription>
        )}
        <CardAction>
          <Link
            to="/songs/$songId/chart"
            params={{ songId }}
            search={{ arrangement: row.id }}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <FileMusic aria-hidden />
            Chord chart
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {rows.length > 1 ? (
            <NativeSelect
              aria-label="Arrangement"
              className="w-full md:w-72"
              value={row.id}
              onChange={(event) => {
                void navigate({
                  to: "/songs/$songId",
                  params: { songId },
                  search: { arrangement: event.target.value },
                  replace: true,
                });
              }}
            >
              {rows.map((candidate) => (
                <NativeSelectOption key={candidate.id} value={candidate.id}>
                  {candidate.archived
                    ? `${candidate.name} (archived)`
                    : candidate.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : null}
          <ArrangementDetails
            row={row}
            option={option}
            optionsLoading={optionsLoading}
          />
        </div>
      </CardContent>
    </Card>
  );
};

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
  const detail = [note, fileSizeLabel(attachment.fileSize)]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <>
      <ItemMedia variant="icon">
        <Icon className="text-muted-foreground" aria-hidden />
      </ItemMedia>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{attachmentName(attachment)}</span>
        {detail === "" ? null : (
          <span className="text-muted-foreground block truncate text-xs">
            {detail}
          </span>
        )}
      </span>
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
          note="Opens in Planning Center"
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

interface AttachmentGroup {
  readonly id: string;
  readonly label: string;
  readonly attachments: readonly SongAttachment[];
}

/** The arrangement's own files first, then each key's, in the arrangement's key order. */
const groupAttachments = (
  attachments: readonly SongAttachment[],
  keys: readonly KeyOption[]
): AttachmentGroup[] => {
  const groups: AttachmentGroup[] = [
    {
      id: "arrangement",
      label: "Arrangement",
      attachments: attachments.filter((file) => file.keyId === null),
    },
    ...keys.map((key) => ({
      id: key.id,
      label: `Key of ${keyLabel(key)}`,
      attachments: attachments.filter((file) => file.keyId === key.id),
    })),
  ];
  const known = new Set(groups.map((group) => group.id));
  const unknownKeyFiles = attachments.filter(
    (file) => file.keyId !== null && !known.has(file.keyId)
  );
  if (unknownKeyFiles.length > 0) {
    groups.push({
      id: "other",
      label: "Other keys",
      attachments: unknownKeyFiles,
    });
  }
  return groups.filter((group) => group.attachments.length > 0);
};

const FilesCard = ({
  songId,
  row,
}: {
  songId: string;
  row: ArrangementRowData;
}) => {
  const files = useSongAttachments(songId, row.id);
  const openAttachment = useOpenSongAttachment(songId, row.id);
  const groups =
    files.data === undefined
      ? []
      : groupAttachments(files.data.attachments, row.keys);
  return (
    <Card size="sm">
      <CardHeader>
        <SectionTitle icon={Paperclip}>Files</SectionTitle>
        <CardDescription>Attached to {row.name} and its keys</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {files.data === undefined && !files.isError ? (
            <div className="flex flex-col gap-2" aria-busy>
              <Skeleton variant="control" className="h-10" />
              <Skeleton variant="control" className="h-10" />
            </div>
          ) : null}
          {files.isError && files.data === undefined ? (
            <div className="text-muted-foreground flex items-center gap-3 text-sm">
              <span>Files didn&apos;t load.</span>
              <Button
                variant="outline"
                size="xs"
                disabled={files.isFetching}
                onClick={() => {
                  void files.refetch();
                }}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {files.data !== undefined && groups.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No files on this arrangement.
            </p>
          ) : null}
          {groups.map((group) => (
            <section key={group.id} className="flex flex-col gap-0.5">
              <h3 className="text-muted-foreground px-2 text-xs font-medium">
                {group.label}
              </h3>
              <ul className="flex flex-col">
                {group.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <AttachmentRow
                      songId={songId}
                      arrangementId={row.id}
                      attachment={attachment}
                      onOpen={openAttachment}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {files.data?.truncated === true ? (
            <a
              href={planningCenterArrangementUrl(songId, row.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground flex items-center gap-1 px-2 text-xs underline-offset-4 hover:underline"
            >
              Some files aren&apos;t listed. See them all in Planning Center
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
};

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
      <span className="text-muted-foreground w-24 shrink-0 text-xs tabular-nums">
        {historyDateLabel(entry.sortDate, now, timeZone)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          {serviceTypeLabel(entry.serviceTypeName)}
        </span>
        {detail === null ? null : (
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

/** Plans with the song ahead, soonest first, then the past year's, newest first. */
const ScheduleCard = ({
  history,
  isError,
  isFetching,
  onRetry,
  now,
}: {
  history: readonly SongHistoryEntry[] | undefined;
  isError: boolean;
  isFetching: boolean;
  onRetry: () => void;
  now: Date;
}) => {
  const timeZone = useOrganizationTimeZone();
  const [showAll, setShowAll] = useState(false);
  if (history === undefined) {
    return (
      <Card size="sm">
        <CardHeader>
          <SectionTitle icon={CalendarDays}>Schedule</SectionTitle>
        </CardHeader>
        <CardContent>
          {isError ? (
            <div className="text-muted-foreground flex items-center gap-3 text-sm">
              <span>History didn&apos;t load.</span>
              <Button
                variant="outline"
                size="xs"
                disabled={isFetching}
                onClick={onRetry}
              >
                Retry
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2" aria-busy>
              <Skeleton variant="text" className="h-3.5 w-full" />
              <Skeleton variant="text" className="h-3.5 w-4/5" />
              <Skeleton variant="text" className="h-3.5 w-3/5" />
            </div>
          )}
        </CardContent>
      </Card>
    );
  }
  const { upcoming, past } = splitSongHistory(history, now);
  const namesArrangement = historyNamesArrangements(history);
  const shownPast = showAll ? past : past.slice(0, HISTORY_PREVIEW_ROWS);
  return (
    <Card size="sm">
      <CardHeader>
        <SectionTitle icon={CalendarDays}>Schedule</SectionTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          <section className="flex flex-col gap-0.5">
            <h3 className="text-muted-foreground px-1.5 text-xs font-medium">
              Upcoming
            </h3>
            {upcoming.length === 0 ? (
              <p className="text-muted-foreground px-1.5 text-sm">
                Not planned yet.
              </p>
            ) : (
              upcoming.map((entry) => (
                <ScheduleRow
                  key={scheduleRowKey(entry)}
                  entry={entry}
                  detail={historyRowDetail(entry, namesArrangement)}
                  now={now}
                  timeZone={timeZone}
                />
              ))
            )}
          </section>
          <section className="flex flex-col gap-0.5">
            <h3 className="text-muted-foreground px-1.5 text-xs font-medium">
              Past year
            </h3>
            {past.length === 0 ? (
              <p className="text-muted-foreground px-1.5 text-sm">
                Not sung in the past year.
              </p>
            ) : (
              shownPast.map((entry) => (
                <ScheduleRow
                  key={scheduleRowKey(entry)}
                  entry={entry}
                  detail={historyRowDetail(entry, namesArrangement)}
                  now={now}
                  timeZone={timeZone}
                />
              ))
            )}
            {past.length > HISTORY_PREVIEW_ROWS ? (
              <Button
                type="button"
                variant="link"
                size="xs"
                className="self-start"
                onClick={() => {
                  setShowAll((current) => !current);
                }}
              >
                {showAll ? "Show less" : `Show all ${past.length}`}
              </Button>
            ) : null}
          </section>
        </div>
      </CardContent>
    </Card>
  );
};

const NoArrangementsCard = ({ songId }: { songId: string }) => (
  <Card size="sm">
    <CardHeader>
      <SectionTitle icon={ListMusic}>Arrangements</SectionTitle>
      <CardDescription>
        This song has no arrangements yet. Chord charts and files belong to one.
      </CardDescription>
      <CardAction>
        <Link
          to="/songs/$songId/chart"
          params={{ songId }}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <FileMusic aria-hidden />
          Chord chart
        </Link>
      </CardAction>
    </CardHeader>
  </Card>
);

/** The chosen arrangement and its files, or why there are none yet. */
const ArrangementSection = ({
  songId,
  rows,
  row,
  option,
  arrangementsKnown,
  optionsLoading,
}: {
  songId: string;
  rows: readonly ArrangementRowData[];
  row: ArrangementRowData | undefined;
  option: ArrangementOption | undefined;
  arrangementsKnown: boolean;
  optionsLoading: boolean;
}) => {
  if (row === undefined) {
    return arrangementsKnown ? (
      <NoArrangementsCard songId={songId} />
    ) : (
      <Skeleton variant="control" className="h-64" />
    );
  }
  return (
    <>
      <ArrangementCard
        songId={songId}
        rows={rows}
        row={row}
        option={option}
        optionsLoading={optionsLoading}
      />
      <FilesCard key={row.id} songId={songId} row={row} />
    </>
  );
};

const SongPageBodySkeleton = () => (
  <div className="grid items-start gap-3 @5xl:grid-cols-[minmax(0,1fr)_20rem]">
    <section className="flex min-w-0 flex-col gap-3">
      <SongFacts history={undefined} now={new Date(0)} />
      <Skeleton variant="control" className="h-64" />
    </section>
    <Skeleton variant="control" className="h-64" />
  </div>
);

export const SongPageSkeleton = () => (
  <PageShell label="Loading song" busy>
    <header className="flex shrink-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-2">
        <Skeleton variant="control" className="h-6 w-56 md:h-7" />
        <Skeleton variant="text" className="h-3.5 w-40" />
      </div>
      <Skeleton
        variant="control"
        className="h-8 w-48 max-md:h-10 max-md:w-full"
      />
    </header>
    <SongPageBodySkeleton />
  </PageShell>
);

/**
 * The song and its arrangements: `songs.options` once it answers (it alone has length, tempo,
 * and meter), the chart read until then. Options answer the same arrangements for any service
 * type, so they read under one the song was sung at, else the organization's first once the
 * history names none.
 */
const useSongArrangements = (
  songId: string,
  history: readonly SongHistoryEntry[] | undefined,
  historyPending: boolean
) => {
  const chart = useChordChartSong(songId);
  const serviceTypes = useServiceTypes();
  const firstServiceTypeId = serviceTypes.data?.[0]?.id ?? null;
  const serviceTypeId =
    historyServiceTypeId(history) ??
    (historyPending ? null : firstServiceTypeId);
  const options = useSongOptions(songId, serviceTypeId);
  const optionSet = options.data ?? undefined;
  const waitingForServiceType =
    serviceTypeId === null && (historyPending || serviceTypes.isPending);
  return {
    chart,
    song: chart.data?.song ?? optionSet?.song ?? null,
    rows: arrangementRows(optionSet?.arrangements, chart.data?.arrangements),
    options: optionSet?.arrangements ?? [],
    known: optionSet !== undefined || chart.data !== undefined,
    optionsLoading: options.isLoading || waitingForServiceType,
  };
};

/**
 * A song as Planning Center has it: when it was sung and where, each arrangement's length,
 * tempo, meter, sequence, and keys, and the files attached to them. Facts only; the chord
 * chart is its own tab.
 */
export const SongPage = ({
  songId,
  arrangementId,
}: {
  songId: string;
  arrangementId: string | null;
}) => {
  const history = useSongHistory(songId);
  const { chart, song, rows, options, known, optionsLoading } =
    useSongArrangements(songId, history.data, history.isPending);
  const now = new Date();

  useEffect(() => {
    if (chart.data !== undefined) {
      rememberRecentSong(chart.data.song);
    }
  }, [chart.data]);

  if (song === null && chart.error !== null && history.isError) {
    return (
      <SongLoadError
        error={chart.error}
        onRetry={() => {
          void chart.refetch();
          void history.refetch();
        }}
      />
    );
  }

  const row =
    rows.find((candidate) => candidate.id === arrangementId) ?? rows[0];
  const option = options.find((candidate) => candidate.id === row?.id);

  return (
    <PageShell>
      <SongPageHeader
        songId={songId}
        title={song?.title ?? null}
        author={song?.author ?? ""}
        tab="overview"
        arrangementId={row?.id ?? null}
      />
      <div className="grid items-start gap-3 @5xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="flex min-w-0 flex-col gap-3">
          <SongFacts history={history.data} now={now} />
          <ArrangementSection
            songId={songId}
            rows={rows}
            row={row}
            option={option}
            arrangementsKnown={known}
            optionsLoading={optionsLoading}
          />
        </section>
        <aside className="flex min-w-0 flex-col gap-3">
          <ScheduleCard
            history={history.data}
            isError={history.isError}
            isFetching={history.isFetching}
            onRetry={() => {
              void history.refetch();
            }}
            now={now}
          />
        </aside>
      </div>
    </PageShell>
  );
};
