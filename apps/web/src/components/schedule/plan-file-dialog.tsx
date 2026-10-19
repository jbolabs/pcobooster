import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import type { PlanItem } from "@pcobooster/planning-center-models/types";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { KeyboardEvent } from "react";

import { HotkeyChord } from "@/components/hotkey-chord";
import { PlanFilesWorkspace } from "@/components/schedule/plan-files-browser";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HoverLabel } from "@/components/ui/hover-card";
import { NEXT_SONG_SHORTCUT, PREVIOUS_SONG_SHORTCUT } from "@/lib/app-hotkeys";
import type { PlanFileDialogState, SongItem } from "@/lib/plan-file-dialog";

type Direction = "previous" | "next";
const shortcutOf = {
  next: NEXT_SONG_SHORTCUT,
  previous: PREVIOUS_SONG_SHORTCUT,
} as const;

/**
 * Arrow keys belong to whatever has focus when it uses them: text fields move the caret,
 * and media players seek.
 */
const targetUsesArrows = (target: EventTarget) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  target instanceof HTMLMediaElement ||
  (target instanceof HTMLElement && target.isContentEditable);

const directionOf = (event: KeyboardEvent<HTMLElement>): Direction | null => {
  const modified =
    event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  if (modified || targetUsesArrows(event.target)) {
    return null;
  }
  if (event.key === shortcutOf.next.binding) {
    return "next";
  }
  return event.key === shortcutOf.previous.binding ? "previous" : null;
};

/** Previous or next song, named, with its shortcut on hover. Disabled at either end. */
const StepButton = ({
  direction,
  song,
  onStep,
}: {
  direction: Direction;
  song: SongItem | null;
  onStep: (song: SongItem) => void;
}) => {
  const shortcut = shortcutOf[direction];
  const title = song?.song.title ?? shortcut.label;
  const content =
    direction === "next" ? (
      <>
        <span className="truncate">{title}</span>
        <ChevronRight />
      </>
    ) : (
      <>
        <ChevronLeft />
        <span className="truncate">{title}</span>
      </>
    );
  // Phones fit both steps in one row, half each.
  const phoneHalf = "max-sm:min-w-0 max-sm:flex-1";
  if (song === null) {
    return (
      <Button type="button" variant="outline" className={phoneHalf} disabled>
        {content}
      </Button>
    );
  }
  return (
    <HoverLabel
      side="top"
      label={<HotkeyChord id={shortcut.id} binding={shortcut.binding} />}
      render={
        <Button
          type="button"
          variant="outline"
          className={phoneHalf}
          aria-label={`${shortcut.label}: ${title}`}
          onClick={() => {
            onStep(song);
          }}
        />
      }
    >
      {content}
    </HoverLabel>
  );
};

const subtitleOf = (item: PlanItem, position: string | null) =>
  [item.arrangement?.name, item.key?.startingKey, position]
    .filter((part) => part !== undefined && part !== null && part !== "")
    .join(" · ");

interface PlanFileDialogProps {
  /** The plan's items, saved ones only. */
  items: PlanItem[];
  /** The plan's songs in service order, which the dialog steps through. */
  songs: SongItem[];
  serviceTypeId: string;
  planId: string;
  /** Null while closed. */
  state: PlanFileDialogState | null;
  onStateChange: (state: PlanFileDialogState | null) => void;
  /** Where focus returns on close. */
  finalFocus: () => HTMLElement | true;
}

/**
 * An item's files, opened on the one chosen in its details: the file large, the item's
 * other files beside it. For songs, the footer and arrow keys step through the plan's
 * songs, reopening the same part or chart on each, so a set can be read or rehearsed
 * start to finish.
 */
export const PlanFileDialog = ({
  items,
  songs,
  serviceTypeId,
  planId,
  state,
  onStateChange,
  finalFocus,
}: PlanFileDialogProps) => {
  const current = items.find((item) => item.id === state?.itemId) ?? null;
  const open = state !== null && current !== null;
  // Kept while closing, so the content doesn't change during the exit animation.
  const [last, setLast] = useState<PlanItem | null>(null);
  if (open && last !== current) {
    setLast(current);
  }
  const item = open ? current : last;
  const index = songs.findIndex((song) => song.id === item?.id);
  const neighbors: Record<Direction, SongItem | null> = {
    previous: index > 0 ? (songs[index - 1] ?? null) : null,
    next: index === -1 ? null : (songs[index + 1] ?? null),
  };

  const step = (song: SongItem) => {
    if (state !== null) {
      onStateChange({ itemId: song.id, file: state.file });
    }
  };
  const remember = (file: PlanFile) => {
    if (state !== null) {
      onStateChange({ itemId: state.itemId, file });
    }
  };
  // Read on the dialog itself: its portal keeps keystrokes from reaching document-wide
  // hotkeys.
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const direction = directionOf(event);
    const target = direction === null ? null : neighbors[direction];
    if (target !== null) {
      event.preventDefault();
      step(target);
    }
  };

  if (item === null || state === null) {
    return null;
  }
  const position =
    index === -1 ? null : `${String(index + 1)} of ${String(songs.length)}`;
  const subtitle = subtitleOf(item, position);
  const title = item.song?.title ?? item.title;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onStateChange(null);
        }
      }}
    >
      <DialogContent
        variant="viewer"
        finalFocus={finalFocus}
        onKeyDown={handleKeyDown}
        // Phones close from the file's own bar, which also carries the title.
        className="max-sm:[&>[data-slot=dialog-close]]:hidden"
      >
        {/* Phones give the file the screen: the header folds into the file's bar, and the
            frame, padding, and gaps start at sm. */}
        <div className="pt-safe pb-safe-2 sm:pt-safe-6 sm:pb-safe-6 flex min-h-0 flex-1 flex-col sm:gap-4 sm:px-6">
          <DialogHeader className="max-sm:sr-only">
            <DialogTitle>{title}</DialogTitle>
            {subtitle === "" ? null : (
              <DialogDescription>{subtitle}</DialogDescription>
            )}
          </DialogHeader>
          <div className="flex min-h-0 flex-1 overflow-hidden sm:rounded-xl sm:border">
            <PlanFilesWorkspace
              // A fresh workspace per item, opening on the counterpart of the file open last.
              key={item.id}
              serviceTypeId={serviceTypeId}
              planId={planId}
              items={[item]}
              item={item}
              embedded
              heading={{ title, subtitle }}
              continueFrom={state.file}
              onChoose={remember}
            />
          </div>
          {index === -1 || songs.length < 2 ? null : (
            <nav
              aria-label="Songs"
              className="flex gap-2 px-2 pt-2 sm:justify-end sm:p-0"
            >
              <StepButton
                direction="previous"
                song={neighbors.previous}
                onStep={step}
              />
              <StepButton
                direction="next"
                song={neighbors.next}
                onStep={step}
              />
            </nav>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
