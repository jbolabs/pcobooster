import type {
  ChordChartArrangement,
  ChordChartSong,
} from "@pcobooster/contracts/http/chord-charts";
import {
  CHORD_CHART_KEYS,
  parseKey,
  transposeKey,
} from "@pcobooster/planning-center-models/chord-chart-chords";
import {
  chartActionLabel,
  missingChartLabel,
  planningCenterArrangementUrl,
  planningCenterSongUrl,
} from "@pcobooster/planning-center-models/song-detail";
import type { SongPageSearch } from "@pcobooster/planning-center-models/song-detail";
import type { KeyOption } from "@pcobooster/planning-center-models/types";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useNavigate } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  Copy,
  Ellipsis,
  ExternalLink,
  Eye,
  FileInput,
  Pencil,
  Plus,
  Search,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { toast } from "sonner";

import { HotkeyChord } from "@/components/hotkey-chord";
import { PageScrollArea, PageShell } from "@/components/page-shell";
import { ChordChartCreateDialog } from "@/components/songs/chord-chart-create-dialog";
import type { ChordChartCreateContent } from "@/components/songs/chord-chart-create-dialog";
import { highlightChordChart } from "@/components/songs/chord-chart-highlight";
import { ChordChartImportDialog } from "@/components/songs/chord-chart-import-dialog";
import { ChordChartLayoutPopover } from "@/components/songs/chord-chart-layout-popover";
import {
  PlanningCenterPdfPages,
  usePlanningCenterPdf,
} from "@/components/songs/planning-center-pdf-preview";
import {
  ArrangementPicker,
  KeyTabs,
  useSongSelection,
} from "@/components/songs/song-arrangement-controls";
import { SongLoadError } from "@/components/songs/song-load-error";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { HighlightedTextarea } from "@/components/ui/highlighted-textarea";
import { HoverLabel } from "@/components/ui/hover-card";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useChordChartEditAccess } from "@/hooks/use-chord-chart-access";
import { useChordChartSong } from "@/hooks/use-chord-chart-song";
import { useChordChartWorkspace } from "@/hooks/use-chord-chart-workspace";
import type { ChordChartWorkspace } from "@/hooks/use-chord-chart-workspace";
import { useIsMobile } from "@/hooks/use-mobile";
import { latchChartMode } from "@/lib/chart-mode";
import type { ChartMode, ChartModeState } from "@/lib/chart-mode";
import type { ChordChartEditAccess } from "@/lib/chord-chart-access";
import { rememberRecentSong } from "@/lib/recent-songs";

const SAVE_HOTKEY = "Mod+S";
const EDIT_HOTKEY = "E";
const COPIED_LABEL_MS = 2000;
const KEYS_PER_MODE = 12;

const SECTION_SNIPPETS = [
  "VERSE 1",
  "PRE-CHORUS",
  "CHORUS",
  "BRIDGE",
  "TAG",
  "INSTRUMENTAL",
] as const;

const CODE_SNIPPETS = [
  { label: "Column break", text: "COLUMN_BREAK" },
  { label: "Page break", text: "PAGE_BREAK" },
  { label: "Page break (charts only)", text: "{{ PAGE_BREAK }}" },
  { label: "Note", text: "{ Note }" },
  { label: "Note (charts only)", text: "{{ Note }}" },
  { label: "Key change up a step", text: "TRANSPOSE KEY +2" },
] as const;

/** A new arrangement starts empty and inherits every print setting. */
const EMPTY_ARRANGEMENT: ChordChartCreateContent = {
  chart: "",
  key: null,
  layout: {},
};

type SaveStatusLabel = "checking" | ChordChartWorkspace["status"];

/** Each status in full, and short enough for a phone's header. */
const STATUS_LABELS: Record<SaveStatusLabel, { full: string; short: string }> =
  {
    checking: { full: "Checking Planning Center…", short: "Checking…" },
    saving: { full: "Saving…", short: "Saving…" },
    unsaved: { full: "Unsaved changes", short: "Unsaved" },
    saved: { full: "Saved to Planning Center", short: "Saved" },
  };

/** The chart's twelve keys in its own mode, for previewing and transposing. */
const keysInMode = (writtenKey: string | null): string[] => {
  const key = parseKey(writtenKey);
  if (key === null) {
    return CHORD_CHART_KEYS.slice(0, KEYS_PER_MODE);
  }
  return Array.from(
    { length: KEYS_PER_MODE },
    (_, step) => transposeKey(key, step).name
  );
};

/** Replaces the textarea's selection and tells React, leaving the caret after the text. */
const insertAtCaret = (
  textarea: HTMLTextAreaElement | null,
  snippet: string
) => {
  if (textarea === null) {
    return;
  }
  const { selectionStart, selectionEnd, value } = textarea;
  const atLineStart =
    selectionStart === 0 || value[selectionStart - 1] === "\n";
  textarea.focus();
  textarea.setRangeText(
    `${atLineStart ? "" : "\n"}${snippet}\n`,
    selectionStart,
    selectionEnd,
    "end"
  );
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
};

const scheduleReset = (reset: () => void): (() => void) => {
  const timeout = window.setTimeout(reset, COPIED_LABEL_MS);
  return () => {
    window.clearTimeout(timeout);
  };
};

const useCopyChart = (chart: string) => {
  const [copied, setCopied] = useState(false);
  useEffect(
    () =>
      copied
        ? scheduleReset(() => {
            setCopied(false);
          })
        : undefined,
    [copied]
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(chart);
      setCopied(true);
    } catch {
      toast.error("Your browser blocked copying. Select the text and copy it.");
    }
  };
  return { copied, copy };
};

/** Copies the chart's text and says so; the browser may refuse. */
const copyChartText = async (chart: string) => {
  try {
    await navigator.clipboard.writeText(chart);
    toast(
      "Chart text copied. Paste it into Lyrics & Chords in Planning Center."
    );
  } catch {
    toast.error("Your browser blocked copying. Select the text and copy it.");
  }
};

const InsertMenu = ({
  textareaRef,
  disabled,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  disabled: boolean;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label="Insert"
        />
      }
    >
      <Plus aria-hidden />
      <span className="max-sm:hidden">Insert</span>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-56">
      <DropdownMenuGroup>
        <DropdownMenuLabel>Section</DropdownMenuLabel>
        {SECTION_SNIPPETS.map((section) => (
          <DropdownMenuItem
            key={section}
            onClick={() => {
              insertAtCaret(textareaRef.current, section);
            }}
          >
            {section}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>Planning Center codes</DropdownMenuLabel>
        {CODE_SNIPPETS.map((code) => (
          <DropdownMenuItem
            key={code.label}
            onClick={() => {
              insertAtCaret(textareaRef.current, code.text);
            }}
          >
            {code.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

const TransposeMenu = ({
  writtenKey,
  disabled,
  onTranspose,
}: {
  writtenKey: string | null;
  disabled: boolean;
  onTranspose: (key: string) => void;
}) => {
  const current = parseKey(writtenKey);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || current === null}
            aria-label="Transpose chords"
          />
        }
      >
        <span>Transpose</span>
        <ChevronDown className="text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Rewrite chords in</DropdownMenuLabel>
          {keysInMode(writtenKey).map((key) => (
            <DropdownMenuItem
              key={key}
              onClick={() => {
                onTranspose(key);
              }}
            >
              <span>{key}</span>
              {key === current?.name ? (
                <Check className="ml-auto" aria-hidden />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** A key Planning Center holds that the list lacks (such as Gb) stays shown as written. */
const WrittenKeySelect = ({
  value,
  disabled,
  onChange,
}: {
  value: string | null;
  disabled: boolean;
  onChange: (key: string | null) => void;
}) => (
  <NativeSelect
    aria-label="Key the chords are written in"
    size="sm"
    value={value ?? ""}
    disabled={disabled}
    onChange={(event) => {
      const next = event.target.value;
      onChange(next === "" ? null : next);
    }}
  >
    <NativeSelectOption value="">No key</NativeSelectOption>
    {value === null || CHORD_CHART_KEYS.includes(value) ? null : (
      <NativeSelectOption
        value={value}
      >{`Written in ${value}`}</NativeSelectOption>
    )}
    <NativeSelectOptGroup label="Major">
      {CHORD_CHART_KEYS.slice(0, KEYS_PER_MODE).map((key) => (
        <NativeSelectOption key={key} value={key}>
          {`Written in ${key}`}
        </NativeSelectOption>
      ))}
    </NativeSelectOptGroup>
    <NativeSelectOptGroup label="Minor">
      {CHORD_CHART_KEYS.slice(KEYS_PER_MODE).map((key) => (
        <NativeSelectOption key={key} value={key}>
          {`Written in ${key}`}
        </NativeSelectOption>
      ))}
    </NativeSelectOptGroup>
  </NativeSelect>
);

/**
 * Where the chart stands against Planning Center, and the Save as you type setting behind it.
 * Saving as you type keeps Planning Center's own PDF preview current while you write.
 */
const SaveStatusMenu = ({ workspace }: { workspace: ChordChartWorkspace }) => {
  const status: SaveStatusLabel = workspace.ready
    ? workspace.status
    : "checking";
  const label = STATUS_LABELS[status];
  const busy = status === "saving" || status === "checking";
  return (
    <DropdownMenu>
      <span className="sr-only" aria-live="polite">
        {label.full}
      </span>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
        {busy ? <Spinner aria-hidden /> : null}
        {status === "saved" ? <Check aria-hidden /> : null}
        <span className="text-muted-foreground text-xs">
          <span className="max-md:hidden">{label.full}</span>
          <span className="md:hidden">{label.short}</span>
        </span>
        <ChevronDown className="text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuCheckboxItem
          checked={workspace.saveAsYouType}
          onCheckedChange={(checked) => {
            workspace.handleSaveAsYouTypeChange(checked);
          }}
        >
          Save as you type
        </DropdownMenuCheckboxItem>
        <p className="text-muted-foreground px-3 pb-2 text-xs">
          Saves to Planning Center a moment after you stop typing, so its
          preview keeps up. Turn it off to save only when you choose.
        </p>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!workspace.canSave}
          onClick={workspace.handleSave}
        >
          Save now
          <HotkeyChord
            id="save-chord-chart"
            binding={SAVE_HOTKEY}
            className="ml-auto"
          />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * Someone saved a newer version in Planning Center while this editor had unsaved edits.
 * Saving waits until the person keeps one, and keeping theirs over yours asks first.
 */
const ConflictNotice = ({ workspace }: { workspace: ChordChartWorkspace }) => {
  const [confirming, setConfirming] = useState(false);
  // Taking theirs discards this editor's text, so it can be copied out first.
  const { copied, copy } = useCopyChart(workspace.draft.chart);
  const theirsLoaded = (workspace.conflict?.theirs ?? null) !== null;
  return (
    <>
      <Alert className="shrink-0">
        <TriangleAlert aria-hidden />
        <AlertTitle>Someone changed this chart in Planning Center</AlertTitle>
        <AlertDescription>
          <p>
            Saving is paused so neither version is lost. Keep theirs, or replace
            it with yours. Copy yours first to keep it either way.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void copy();
              }}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Copied" : "Copy mine"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!theirsLoaded}
              onClick={workspace.handleUseTheirs}
            >
              Use the Planning Center version
            </Button>
            <Button
              size="sm"
              disabled={!theirsLoaded}
              onClick={() => {
                setConfirming(true);
              }}
            >
              Keep mine
            </Button>
            {theirsLoaded ? null : (
              <Button
                variant="ghost"
                size="sm"
                onClick={workspace.handleRetryTheirs}
              >
                Load their version
              </Button>
            )}
          </div>
        </AlertDescription>
      </Alert>
      <DeleteConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Replace their version with yours?"
        description="Saves your chart to Planning Center as it is now. The changes they saved are lost."
        confirmLabel="Keep mine"
        onConfirm={() => {
          setConfirming(false);
          workspace.handleKeepMine();
        }}
      />
    </>
  );
};

const SaveControls = ({ workspace }: { workspace: ChordChartWorkspace }) => (
  <>
    <SaveStatusMenu workspace={workspace} />
    {workspace.needsSave ? (
      <Button size="sm" onClick={workspace.handleSave}>
        Save
      </Button>
    ) : null}
  </>
);

/**
 * Copying the chart's text, Planning Center, and (while editing) the edits that act on the
 * whole arrangement.
 */
const ChartMoreMenu = ({
  song,
  arrangement,
  chart,
  children,
}: {
  song: ChordChartSong;
  arrangement: ChordChartArrangement;
  /** The chart text to copy: the draft while editing, else the saved chart. */
  chart: string;
  /** Edit mode's items, listed after Copy chart text. */
  children?: ReactNode;
}) => (
  <DropdownMenu>
    <HoverLabel
      label="More actions"
      side="bottom"
      render={
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="More actions" />
          }
        />
      }
    >
      <Ellipsis aria-hidden />
    </HoverLabel>
    <DropdownMenuContent align="end" className="w-64">
      <DropdownMenuItem
        disabled={chart.trim() === ""}
        onClick={() => {
          void copyChartText(chart);
        }}
      >
        <Copy aria-hidden />
        Copy chart text
      </DropdownMenuItem>
      {children}
      <DropdownMenuItem
        onClick={() => {
          window.open(
            planningCenterArrangementUrl(song.id, arrangement.id),
            "_blank",
            "noopener,noreferrer"
          );
        }}
      >
        <ExternalLink aria-hidden />
        Open in Planning Center
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

/** One row of controls above the chart, wrapping on phones. */
const ChartToolbar = ({ children }: { children: ReactNode }) => (
  <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1">
    {children}
  </div>
);

/** Edit and Done on phones: one full-width action at the bottom of the screen. */
const PhoneBottomAction = ({ children }: { children: ReactNode }) => (
  <div className="bg-background pb-safe-3 sticky bottom-0 z-10 pt-2 md:hidden">
    {children}
  </div>
);

/** Focuses the first of `elements` that is on screen (phones and desktops show different ones). */
const focusVisible = (elements: readonly (HTMLElement | null)[]) => {
  elements
    .find((element) => element !== null && element.offsetParent !== null)
    ?.focus();
};

interface ChartViewProps {
  song: ChordChartSong;
  arrangement: ChordChartArrangement;
  /** Active first, then archived. */
  arrangements: readonly ChordChartArrangement[];
  /** The key whose chart shows; null for the lyrics sheet. */
  chartKey: KeyOption | null;
  onShow: (search: SongPageSearch) => void;
  /** The person switched modes, so focus moves to where they will work. */
  takeFocus: boolean;
}

/**
 * The chart as Planning Center saved it: its own PDF for the chosen key (the lyrics sheet
 * without one), full width. People who can edit get an Edit button (and E); nobody else sees
 * editing at all.
 */
const ChartReader = ({
  song,
  arrangement,
  arrangements,
  chartKey,
  onShow,
  takeFocus,
  onEdit,
}: ChartViewProps & { onEdit: (() => void) | null }) => {
  const { pagesRef, pdf } = usePlanningCenterPdf({
    songId: song.id,
    arrangement,
    keyId: chartKey?.id ?? null,
  });
  const editRef = useRef<HTMLButtonElement>(null);
  const phoneEditRef = useRef<HTMLButtonElement>(null);
  const focusOnOpen = useRef(takeFocus);
  useEffect(() => {
    if (focusOnOpen.current) {
      focusVisible([editRef.current, phoneEditRef.current]);
    }
  }, []);
  return (
    <PageShell layout="fill">
      <h1 className="sr-only">{`${song.title}, ${chartActionLabel(chartKey).toLowerCase()}`}</h1>
      <ChartToolbar>
        <ArrangementPicker
          arrangements={arrangements}
          arrangement={arrangement}
          onShow={onShow}
        />
        <KeyTabs
          arrangement={arrangement}
          keyId={chartKey?.id ?? null}
          onShow={onShow}
        />
        <div className="ml-auto flex items-center gap-1.5">
          {pdf.rendering ? (
            <Spinner aria-label="Rendering in Planning Center" />
          ) : null}
          {onEdit === null ? null : (
            <Button
              ref={editRef}
              variant="outline"
              size="sm"
              className="max-md:hidden"
              onClick={onEdit}
            >
              <Pencil aria-hidden />
              Edit
              <HotkeyChord id="edit-chord-chart" binding={EDIT_HOTKEY} />
            </Button>
          )}
          <ChartMoreMenu
            song={song}
            arrangement={arrangement}
            chart={arrangement.chordChart}
          />
        </div>
      </ChartToolbar>
      <PageScrollArea>
        <div className="flex flex-col items-center pb-4">
          <div className="md:bg-muted/40 flex w-full max-w-[52rem] flex-col md:rounded-2xl md:p-6">
            <PlanningCenterPdfPages
              pdf={pdf}
              pagesRef={pagesRef}
              missingLabel={missingChartLabel(chartKey)}
              missingAction={
                onEdit === null ? null : (
                  <Button variant="outline" size="sm" onClick={onEdit}>
                    Edit chart
                  </Button>
                )
              }
            />
          </div>
        </div>
      </PageScrollArea>
      {onEdit === null ? null : (
        <PhoneBottomAction>
          <Button
            ref={phoneEditRef}
            size="lg"
            className="w-full"
            onClick={onEdit}
          >
            <Pencil aria-hidden />
            Edit
          </Button>
        </PhoneBottomAction>
      )}
    </PageShell>
  );
};

const EditorPane = ({
  workspace,
  textareaRef,
}: {
  workspace: ChordChartWorkspace;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) => {
  const { draft } = workspace;
  const highlighted = useMemo(
    () => highlightChordChart(draft.chart),
    [draft.chart]
  );
  return (
    <section aria-label="Chart text" className="flex min-h-0 flex-1 flex-col">
      <HighlightedTextarea
        ref={textareaRef}
        aria-label="Lyrics and chords"
        className="min-h-80 flex-1"
        placeholder={
          "VERSE 1\n[G]Type lyrics with [C]chords in brackets\n\nCHORUS\n..."
        }
        readOnly={!workspace.ready}
        value={draft.chart}
        highlight={highlighted}
        onChange={(event) => {
          workspace.handleChartChange(event.target.value);
        }}
      />
    </section>
  );
};

/** Why the preview may trail the editor, with a way to catch it up. */
const PreviewStatus = ({ workspace }: { workspace: ChordChartWorkspace }) => {
  if (workspace.conflict !== null) {
    return (
      <p className="text-muted-foreground px-3 pb-2 text-xs">
        The preview shows the version saved in Planning Center.
      </p>
    );
  }
  if (!workspace.needsSave) {
    return null;
  }
  return (
    <p className="text-muted-foreground flex items-center gap-2 px-3 pb-2 text-xs">
      The preview shows the last saved chart.
      <Button size="xs" onClick={workspace.handleSave}>
        Save to update
      </Button>
    </p>
  );
};

/** Planning Center's PDF of the last save, in the URL's key, beside the editor. */
const PreviewPane = ({
  song,
  arrangement,
  chartKey,
  onShow,
  workspace,
}: Pick<ChartViewProps, "song" | "arrangement" | "chartKey" | "onShow"> & {
  workspace: ChordChartWorkspace;
}) => {
  const { pagesRef, pdf } = usePlanningCenterPdf({
    songId: song.id,
    arrangement,
    keyId: chartKey?.id ?? null,
  });
  return (
    <section
      aria-label="Preview"
      className="bg-muted/40 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl"
    >
      <div className="flex flex-wrap items-center gap-1.5 p-2">
        {arrangement.keys.length > 1 ? (
          <KeyTabs
            arrangement={arrangement}
            keyId={chartKey?.id ?? null}
            onShow={onShow}
          />
        ) : (
          <p className="text-muted-foreground px-1.5 text-sm">
            {chartKey === null ? "Lyrics sheet" : chartActionLabel(chartKey)}
          </p>
        )}
        {pdf.rendering ? (
          <Spinner aria-label="Rendering in Planning Center" />
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <ChordChartLayoutPopover
            layout={workspace.draft.layout}
            disabled={!workspace.ready}
            onChange={workspace.handleLayoutChange}
          />
        </div>
      </div>
      <PreviewStatus workspace={workspace} />
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
        <PlanningCenterPdfPages
          pdf={pdf}
          pagesRef={pagesRef}
          missingLabel={missingChartLabel(chartKey)}
        />
      </div>
    </section>
  );
};

type WorkspaceDialog = "import" | "copy" | "revert";

/**
 * Why Done can't leave yet, or null when it can (once any save in flight lands). Leaving never
 * strands edits: a pending save goes out first, and edits that can't save keep the editor open.
 */
const doneBlockedReason = (workspace: ChordChartWorkspace): string | null => {
  if (workspace.conflict !== null) {
    return "Keep one version of the chart before leaving the editor.";
  }
  if (workspace.status !== "unsaved") {
    return null;
  }
  if (workspace.saveFailed) {
    return "The last save didn’t reach Planning Center. Save again, or revert your changes.";
  }
  if (!workspace.saveAsYouType) {
    return "Save your changes first, or turn on Save as you type.";
  }
  return workspace.canSave ? null : "Your changes haven’t saved yet.";
};

/**
 * Editing the chart: the text beside Planning Center's preview (a sheet on phones), saved as
 * you type. Done saves anything pending, then goes back to reading.
 */
const ChartEditor = ({
  song,
  arrangement,
  arrangements,
  chartKey,
  onShow,
  takeFocus,
  onDone,
}: ChartViewProps & { onDone: () => void }) => {
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<WorkspaceDialog | null>(null);
  const workspace = useChordChartWorkspace({
    songId: song.id,
    arrangement,
    // Copying sends the chart as it is now; saving the original meanwhile would surprise.
    held: dialog === "copy",
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const dialogOpenChange = (name: WorkspaceDialog) => (open: boolean) => {
    setDialog(open ? name : null);
  };
  const editable = workspace.ready;
  const empty = workspace.draft.chart.trim() === "";

  useHotkey(SAVE_HOTKEY, workspace.handleSave, {
    ignoreInputs: false,
    preventDefault: true,
  });

  const focusOnOpen = useRef(takeFocus);
  useEffect(() => {
    if (focusOnOpen.current) {
      textareaRef.current?.focus();
    }
  }, []);

  const handleDone = () => {
    const reason = doneBlockedReason(workspace);
    setBlocked(reason);
    if (reason !== null) {
      return;
    }
    if (workspace.status === "saved") {
      onDone();
      return;
    }
    setLeaving(true);
    workspace.handleSaveThen({
      onSaved: onDone,
      onFailed: () => {
        setLeaving(false);
        setBlocked(
          "The last save didn’t reach Planning Center. Save again, or revert your changes."
        );
      },
    });
  };

  const preview = (
    <PreviewPane
      song={song}
      arrangement={arrangement}
      chartKey={chartKey}
      onShow={onShow}
      workspace={workspace}
    />
  );
  const doneLabel = leaving ? "Saving…" : "Done";

  return (
    <PageShell layout="fill">
      <h1 className="sr-only">{`Editing ${song.title}`}</h1>
      <ChartToolbar>
        <ArrangementPicker
          arrangements={arrangements}
          arrangement={arrangement}
          onShow={onShow}
        />
        <WrittenKeySelect
          value={workspace.draft.key}
          disabled={!editable}
          onChange={workspace.handleKeyChange}
        />
        <TransposeMenu
          writtenKey={workspace.draft.key}
          disabled={!editable}
          onTranspose={workspace.handleTranspose}
        />
        <InsertMenu textareaRef={textareaRef} disabled={!editable} />
        <Button
          variant={empty ? "secondary" : "ghost"}
          size="sm"
          disabled={!editable}
          aria-label={empty ? "Find lyrics" : "Import lyrics or chords"}
          onClick={() => {
            setDialog("import");
          }}
        >
          {empty ? <Search aria-hidden /> : <FileInput aria-hidden />}
          <span className="max-sm:hidden">
            {empty ? "Find lyrics" : "Import"}
          </span>
        </Button>
        <ChartMoreMenu
          song={song}
          arrangement={arrangement}
          chart={workspace.draft.chart}
        >
          <DropdownMenuItem
            disabled={!editable}
            onClick={() => {
              setDialog("copy");
            }}
          >
            <Plus aria-hidden />
            Copy to new arrangement…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!editable || !workspace.revertable}
            onClick={() => {
              setDialog("revert");
            }}
          >
            <Undo2 aria-hidden />
            Revert all changes…
          </DropdownMenuItem>
        </ChartMoreMenu>
        <div className="ml-auto flex items-center gap-1.5">
          {isMobile ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPreviewOpen(true);
              }}
            >
              <Eye aria-hidden />
              Preview
            </Button>
          ) : null}
          <SaveControls workspace={workspace} />
          <Button
            variant="outline"
            size="sm"
            className="max-md:hidden"
            disabled={leaving}
            onClick={handleDone}
          >
            {doneLabel}
          </Button>
        </div>
      </ChartToolbar>
      {blocked === null ? null : (
        <output className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
          <TriangleAlert className="size-3.5" aria-hidden />
          {blocked}
        </output>
      )}
      {workspace.restored ? (
        <p className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
          Unsaved draft restored from this browser.
          <Button variant="link" size="xs" onClick={workspace.handleDiscard}>
            Discard
          </Button>
        </p>
      ) : null}
      {workspace.conflict === null ? null : (
        <ConflictNotice workspace={workspace} />
      )}
      <div className="flex min-h-0 flex-1 gap-3 max-md:min-h-[70svh] md:grid md:grid-cols-2">
        <EditorPane workspace={workspace} textareaRef={textareaRef} />
        {isMobile ? null : preview}
      </div>
      <PhoneBottomAction>
        <Button
          size="lg"
          variant="outline"
          className="w-full"
          disabled={leaving}
          onClick={handleDone}
        >
          {doneLabel}
        </Button>
      </PhoneBottomAction>
      {/* The PDF loads only while the sheet is open, so typing on a phone costs no renders. */}
      <Drawer
        open={isMobile && previewOpen}
        onOpenChange={setPreviewOpen}
        showSwipeHandle
      >
        <DrawerContent className="h-[calc(100dvh-3rem)]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-left">
              Planning Center preview
            </DrawerTitle>
            <DrawerDescription className="sr-only">
              The chord chart as Planning Center renders it.
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col px-2">{preview}</div>
        </DrawerContent>
      </Drawer>
      <ChordChartImportDialog
        open={dialog === "import"}
        onOpenChange={dialogOpenChange("import")}
        song={song}
        arrangements={arrangements}
        onImport={workspace.handleImport}
      />
      <ChordChartCreateDialog
        open={dialog === "copy"}
        onOpenChange={dialogOpenChange("copy")}
        songId={song.id}
        content={workspace.copy ?? EMPTY_ARRANGEMENT}
        copyOf={{
          name: arrangement.name,
          savedChanges: workspace.savedChanges,
          unsavedChanges: workspace.unsavedChanges,
        }}
        onCreated={(created) => {
          workspace.handleCopied();
          void navigate({
            to: "/songs/$songId/chart",
            params: { songId: song.id },
            search: { arrangement: created.id },
          });
        }}
      />
      <DeleteConfirmationDialog
        open={dialog === "revert"}
        onOpenChange={dialogOpenChange("revert")}
        title="Revert all changes?"
        description={
          workspace.saveAsYouType
            ? "Puts back the chart, key, and formatting as they were before your changes, and saves that to Planning Center."
            : "Puts back the chart, key, and formatting as they were before your changes. Save to update Planning Center."
        }
        confirmLabel="Revert"
        onConfirm={() => {
          setDialog(null);
          workspace.handleRevert();
        }}
      />
    </PageShell>
  );
};

export const ChordChartEditorPageSkeleton = () => (
  <PageShell layout="fill" label="Loading chord chart" busy>
    <div className="flex shrink-0 items-center gap-3">
      <Skeleton variant="text" className="h-5 w-48" />
      <Skeleton variant="control" className="ml-auto h-8 w-20 max-md:hidden" />
    </div>
    <div className="flex flex-col items-center">
      <Skeleton
        variant="control"
        className="aspect-[8.5/11] w-full max-w-[52rem]"
      />
    </div>
  </PageShell>
);

/**
 * A song without arrangements: editors can create one to write in; everyone else gets one
 * line and Planning Center.
 */
const NoArrangements = ({
  song,
  canCreate,
}: {
  song: ChordChartSong;
  canCreate: boolean;
}) => {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  if (!canCreate) {
    return (
      <PageShell>
        <h1 className="sr-only">{song.title}</h1>
        <p className="text-muted-foreground text-sm">
          No arrangements yet ·{" "}
          <a
            href={planningCenterSongUrl(song.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
          >
            Open in Planning Center
            <ExternalLink className="size-3" aria-hidden />
          </a>
        </p>
      </PageShell>
    );
  }
  return (
    <PageShell layout="center">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{song.title} has no arrangements</EmptyTitle>
          <EmptyDescription>
            Chord charts belong to an arrangement. Create one to start writing.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            Create arrangement
          </Button>
        </EmptyContent>
      </Empty>
      <ChordChartCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        songId={song.id}
        content={EMPTY_ARRANGEMENT}
        copyOf={null}
        onCreated={(created) => {
          void navigate({
            to: "/songs/$songId/chart",
            params: { songId: song.id },
            search: { arrangement: created.id },
          });
        }}
      />
    </PageShell>
  );
};

/** Whether a key press belongs to an open menu or another control, not the page. */
const isInsideControl = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('[role="menu"], [role="listbox"], [role="dialog"]') !== null;

/**
 * The chart's mode: decided once per arrangement (see `latchChartMode`), then whatever the
 * person chooses with Edit, E, or Done.
 */
const useChartMode = (
  arrangement: ChordChartArrangement | null,
  access: ChordChartEditAccess
) => {
  const canEdit = access === "editor";
  const [modeState, setModeState] = useState<ChartModeState | null>(null);
  const latched = latchChartMode(modeState, arrangement, access);
  if (latched !== modeState) {
    setModeState(latched);
  }
  const current =
    modeState !== null && modeState.arrangementId === arrangement?.id
      ? modeState
      : null;
  const mode: ChartMode = canEdit && current?.mode === "edit" ? "edit" : "read";
  const choose = (next: ChartMode) => {
    if (arrangement !== null) {
      setModeState({ arrangementId: arrangement.id, mode: next, chosen: true });
    }
  };

  useHotkey(
    EDIT_HOTKEY,
    (event) => {
      if (!isInsideControl(event.target)) {
        choose("edit");
      }
    },
    {
      enabled: canEdit && arrangement !== null && mode === "read",
      ignoreInputs: true,
    }
  );

  return { mode, takeFocus: current?.chosen ?? false, choose };
};

/**
 * A song's chart. It opens to read Planning Center's saved PDF; editing is a mode people who
 * can edit choose. An empty chart opens straight into it, decided once when the arrangement
 * opens, so the first save (which fills the chart) doesn't send the editor away. The
 * arrangement and key live in the URL, shared with the song's page.
 */
export const ChordChartEditorPage = ({
  songId,
  search,
}: {
  songId: string;
  search: SongPageSearch;
}) => {
  const { data, error, refetch } = useChordChartSong(songId);
  const access = useChordChartEditAccess();
  const canEdit = access === "editor";
  const { selection, show } = useSongSelection(
    songId,
    "/songs/$songId/chart",
    data?.arrangements,
    search
  );
  const openedSong = data?.song;
  useEffect(() => {
    if (openedSong !== undefined) {
      rememberRecentSong(openedSong);
    }
  }, [openedSong]);

  const arrangement = selection?.arrangement ?? null;
  const { mode, takeFocus, choose } = useChartMode(arrangement, access);

  if (data === undefined || selection === null) {
    return error === null ? (
      <ChordChartEditorPageSkeleton />
    ) : (
      <SongLoadError
        error={error}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }
  if (arrangement === null) {
    return <NoArrangements song={data.song} canCreate={canEdit} />;
  }
  const view: ChartViewProps = {
    song: data.song,
    arrangement,
    arrangements: selection.arrangements,
    chartKey: selection.key,
    onShow: show,
    takeFocus,
  };
  return mode === "edit" ? (
    <ChartEditor
      key={arrangement.id}
      {...view}
      onDone={() => {
        choose("read");
      }}
    />
  ) : (
    <ChartReader
      {...view}
      onEdit={
        canEdit
          ? () => {
              choose("edit");
            }
          : null
      }
    />
  );
};
