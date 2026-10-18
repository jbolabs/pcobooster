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
  DialogFooter,
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
  if (song === null) {
    return (
      <Button type="button" variant="outline" disabled>
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
      >
        <div className="pt-safe-6 pb-safe-6 flex min-h-0 flex-1 flex-col gap-4 px-6">
          <DialogHeader>
            <DialogTitle>{item.song?.title ?? item.title}</DialogTitle>
            {subtitle === "" ? null : (
              <DialogDescription>{subtitle}</DialogDescription>
            )}
          </DialogHeader>
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border">
            <PlanFilesWorkspace
              // A fresh workspace per item, opening on the counterpart of the file open last.
              key={item.id}
              serviceTypeId={serviceTypeId}
              planId={planId}
              items={[item]}
              item={item}
              embedded
              continueFrom={state.file}
              onChoose={remember}
            />
          </div>
          {index === -1 || songs.length < 2 ? null : (
            <DialogFooter>
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
            </DialogFooter>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
