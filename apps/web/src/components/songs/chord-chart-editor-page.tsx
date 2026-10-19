import type {
  ChordChartArrangement,
  ChordChartSong,
} from "@pcobooster/contracts/http/chord-charts";
import {
  CHORD_CHART_KEYS,
  parseKey,
  transposeKey,
} from "@pcobooster/planning-center-models/chord-chart-chords";
import { planningCenterArrangementUrl } from "@pcobooster/planning-center-models/song-detail";
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
  Lock,
  Plus,
  Search,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { toast } from "sonner";

import { HotkeyChord } from "@/components/hotkey-chord";
import { PageShell } from "@/components/page-shell";
import { ChordChartCreateDialog } from "@/components/songs/chord-chart-create-dialog";
import type { ChordChartCreateContent } from "@/components/songs/chord-chart-create-dialog";
import { highlightChordChart } from "@/components/songs/chord-chart-highlight";
import { ChordChartImportDialog } from "@/components/songs/chord-chart-import-dialog";
import { ChordChartLayoutPopover } from "@/components/songs/chord-chart-layout-popover";
import { PlanningCenterPdfPreview } from "@/components/songs/planning-center-pdf-preview";
import { BackToSongs, SongLoadError } from "@/components/songs/song-load-error";
import { SongPageHeader } from "@/components/songs/song-page-header";
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
import type { ChordChartEditAccess } from "@/lib/chord-chart-access";
import { rememberRecentSong } from "@/lib/recent-songs";

const SAVE_HOTKEY = "Mod+S";
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

const SaveControls = ({
  workspace,
  access,
}: {
  workspace: ChordChartWorkspace;
  access: ChordChartEditAccess;
}) => {
  if (!access.canEdit) {
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Lock className="size-3.5" aria-hidden />
        View only
      </p>
    );
  }
  return (
    <>
      <SaveStatusMenu workspace={workspace} />
      {workspace.needsSave ? (
        <Button size="sm" onClick={workspace.handleSave}>
          Save
        </Button>
      ) : null}
    </>
  );
};

interface WorkspaceHeaderProps {
  song: ChordChartSong;
  arrangement: ChordChartArrangement;
  arrangements: readonly ChordChartArrangement[];
  workspace: ChordChartWorkspace;
  access: ChordChartEditAccess;
  onImport: () => void;
  onCopy: () => void;
  onRevert: () => void;
}

/**
 * The editor's toolbar under the song's tabs: the arrangement and its actions, with the save
 * status last; phones put the save status on its own row above them.
 */
const WorkspaceHeader = ({
  song,
  arrangement,
  arrangements,
  workspace,
  access,
  onImport,
  onCopy,
  onRevert,
}: WorkspaceHeaderProps) => {
  const navigate = useNavigate();
  const { copied, copy } = useCopyChart(workspace.draft.chart);
  const editable = access.canEdit && workspace.ready;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 max-md:w-full max-md:basis-full">
        <NativeSelect
          aria-label="Arrangement"
          size="sm"
          className="min-w-0 max-md:flex-1"
          value={arrangement.id}
          onChange={(event) => {
            void navigate({
              to: "/songs/$songId/chart",
              params: { songId: song.id },
              search: { arrangement: event.target.value },
              replace: true,
            });
          }}
        >
          {arrangements.map((candidate) => (
            <NativeSelectOption key={candidate.id} value={candidate.id}>
              {candidate.archived
                ? `${candidate.name} (archived)`
                : candidate.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button
          variant="outline"
          size="sm"
          disabled={!editable}
          aria-label="Import lyrics or chords"
          onClick={onImport}
        >
          <FileInput aria-hidden />
          <span className="max-sm:hidden">Import</span>
        </Button>
        <DropdownMenu>
          <HoverLabel
            label="More actions"
            side="bottom"
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label="More actions"
                  />
                }
              />
            }
          >
            <Ellipsis aria-hidden />
          </HoverLabel>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem
              onClick={() => {
                void copy();
              }}
            >
              <Copy aria-hidden />
              Copy chart text
            </DropdownMenuItem>
            {access.canEdit ? (
              <>
                <DropdownMenuItem disabled={!editable} onClick={onCopy}>
                  <Plus aria-hidden />
                  Copy to new arrangement…
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!editable || !workspace.revertable}
                  onClick={onRevert}
                >
                  <Undo2 aria-hidden />
                  Revert all changes…
                </DropdownMenuItem>
              </>
            ) : null}
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
      </div>
      <div className="flex shrink-0 items-center gap-1.5 max-md:order-first max-md:ml-auto">
        <SaveControls workspace={workspace} access={access} />
      </div>
      {copied ? (
        <p className="text-muted-foreground w-full text-xs" aria-live="polite">
          Copied. Paste it into Lyrics &amp; Chords in Planning Center.
        </p>
      ) : null}
    </div>
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

const ViewOnlyNotice = ({ reason }: { reason: string }) => (
  <Alert variant="info" className="shrink-0">
    <Lock aria-hidden />
    <AlertTitle>View only</AlertTitle>
    <AlertDescription>{reason}</AlertDescription>
  </Alert>
);

const EditorPane = ({
  workspace,
  access,
  onFindLyrics,
  onPreview,
}: {
  workspace: ChordChartWorkspace;
  access: ChordChartEditAccess;
  onFindLyrics: () => void;
  /** On phones the preview opens from here instead of sitting beside the editor. */
  onPreview: (() => void) | null;
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { draft } = workspace;
  const highlighted = useMemo(
    () => highlightChordChart(draft.chart),
    [draft.chart]
  );
  const editable = access.canEdit && workspace.ready;
  return (
    <section
      aria-label="Chart text"
      className="flex min-h-0 flex-1 flex-col gap-2"
    >
      {access.canEdit ? null : <ViewOnlyNotice reason={access.reason} />}
      {access.canEdit && workspace.conflict !== null ? (
        <ConflictNotice workspace={workspace} />
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <WrittenKeySelect
          value={draft.key}
          disabled={!editable}
          onChange={workspace.handleKeyChange}
        />
        <TransposeMenu
          writtenKey={draft.key}
          disabled={!editable}
          onTranspose={workspace.handleTranspose}
        />
        <InsertMenu textareaRef={textareaRef} disabled={!editable} />
        {editable && draft.chart.trim() === "" ? (
          <Button variant="secondary" size="sm" onClick={onFindLyrics}>
            <Search aria-hidden />
            Find lyrics
          </Button>
        ) : null}
        {onPreview === null ? null : (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={onPreview}
          >
            <Eye aria-hidden />
            Preview
          </Button>
        )}
        {workspace.restored ? (
          <p className="text-muted-foreground ml-auto flex items-center gap-1 text-xs">
            Unsaved draft restored from this browser.
            <Button variant="link" size="xs" onClick={workspace.handleDiscard}>
              Discard
            </Button>
          </p>
        ) : null}
      </div>
      <HighlightedTextarea
        ref={textareaRef}
        aria-label="Lyrics and chords"
        className="min-h-80 flex-1"
        placeholder={
          "VERSE 1\n[G]Type lyrics with [C]chords in brackets\n\nCHORUS\n..."
        }
        readOnly={!editable}
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

const PreviewPane = ({
  songId,
  arrangement,
  workspace,
  access,
}: {
  songId: string;
  arrangement: ChordChartArrangement;
  workspace: ChordChartWorkspace;
  access: ChordChartEditAccess;
}) => (
  <section
    aria-label="Preview"
    className="bg-muted/40 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl"
  >
    <PlanningCenterPdfPreview
      songId={songId}
      arrangement={arrangement}
      status={<PreviewStatus workspace={workspace} />}
      actions={
        access.canEdit ? (
          <ChordChartLayoutPopover
            layout={workspace.draft.layout}
            disabled={!workspace.ready}
            onChange={workspace.handleLayoutChange}
          />
        ) : null
      }
    />
  </section>
);

type WorkspaceDialog = "import" | "copy" | "revert";

interface WorkspaceProps {
  song: ChordChartSong;
  arrangement: ChordChartArrangement;
  arrangements: readonly ChordChartArrangement[];
}

const ChordChartWorkspaceView = ({
  song,
  arrangement,
  arrangements,
}: WorkspaceProps) => {
  const navigate = useNavigate();
  const access = useChordChartEditAccess();
  const [dialog, setDialog] = useState<WorkspaceDialog | null>(null);
  const workspace = useChordChartWorkspace({
    songId: song.id,
    arrangement,
    canEdit: access.canEdit,
    // Copying sends the chart as it is now; saving the original meanwhile would surprise.
    held: dialog === "copy",
  });
  const isMobile = useIsMobile();
  const [previewOpen, setPreviewOpen] = useState(false);
  const dialogOpenChange = (name: WorkspaceDialog) => (open: boolean) => {
    setDialog(open ? name : null);
  };

  useHotkey(SAVE_HOTKEY, workspace.handleSave, {
    ignoreInputs: false,
    preventDefault: true,
  });

  return (
    <PageShell layout="fill">
      <SongPageHeader
        songId={song.id}
        title={song.title}
        author={song.author}
        tab="chart"
        arrangementId={arrangement.id}
      />
      <WorkspaceHeader
        song={song}
        arrangement={arrangement}
        arrangements={arrangements}
        workspace={workspace}
        access={access}
        onImport={() => {
          setDialog("import");
        }}
        onCopy={() => {
          setDialog("copy");
        }}
        onRevert={() => {
          setDialog("revert");
        }}
      />
      <div className="flex min-h-0 flex-1 gap-3 max-md:min-h-[70svh] md:grid md:grid-cols-2">
        <EditorPane
          workspace={workspace}
          access={access}
          onFindLyrics={() => {
            setDialog("import");
          }}
          onPreview={
            isMobile
              ? () => {
                  setPreviewOpen(true);
                }
              : null
          }
        />
        {isMobile ? null : (
          <PreviewPane
            songId={song.id}
            arrangement={arrangement}
            workspace={workspace}
            access={access}
          />
        )}
      </div>
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
          <div className="flex min-h-0 flex-1 flex-col px-2">
            <PreviewPane
              songId={song.id}
              arrangement={arrangement}
              workspace={workspace}
              access={access}
            />
          </div>
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
    <Skeleton variant="text" className="h-6 w-56" />
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2">
      <Skeleton variant="control" className="h-96" />
      <Skeleton variant="control" className="h-96 max-md:hidden" />
    </div>
  </PageShell>
);

const NoArrangements = ({ song }: { song: ChordChartSong }) => {
  const navigate = useNavigate();
  const access = useChordChartEditAccess();
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <PageShell layout="center">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{song.title} has no arrangements</EmptyTitle>
          <EmptyDescription>
            {access.canEdit
              ? "Chord charts belong to an arrangement. Create one to start writing."
              : "Chord charts belong to an arrangement, and this song has none yet."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {access.canEdit ? (
            <Button
              onClick={() => {
                setCreateOpen(true);
              }}
            >
              Create arrangement
            </Button>
          ) : (
            <BackToSongs />
          )}
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

export const ChordChartEditorPage = ({
  songId,
  arrangementId,
}: {
  songId: string;
  arrangementId: string | null;
}) => {
  const { data, error, refetch } = useChordChartSong(songId);
  const openedSong = data?.song;
  useEffect(() => {
    if (openedSong !== undefined) {
      rememberRecentSong(openedSong);
    }
  }, [openedSong]);
  if (data === undefined) {
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
  const arrangement =
    data.arrangements.find((candidate) => candidate.id === arrangementId) ??
    data.arrangements.find((candidate) => !candidate.archived) ??
    data.arrangements[0];
  if (arrangement === undefined) {
    return <NoArrangements song={data.song} />;
  }
  return (
    <ChordChartWorkspaceView
      key={arrangement.id}
      song={data.song}
      arrangement={arrangement}
      arrangements={data.arrangements}
    />
  );
};
