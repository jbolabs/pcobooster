import { Key01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  keyName,
  parseMusicalKey,
} from "@pcobooster/planning-center-models/key-theory";
import type { MusicalKey } from "@pcobooster/planning-center-models/key-theory";
import {
  rankAlternateKeys,
  suggestionNote,
  transitionSuggestions,
} from "@pcobooster/planning-center-models/key-transition-advice";
import type {
  AdviceSegment,
  KeyTransitionLevel,
} from "@pcobooster/planning-center-models/key-transition-advice";
import { keyOptionLabelOf } from "@pcobooster/planning-center-models/plan-overview";
import type { KeyTransition } from "@pcobooster/planning-center-models/plan-set-insights";
import type {
  ArrangementOption,
  KeyOption,
} from "@pcobooster/planning-center-models/types";
import { Check, NotebookPen } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { HoverLabel } from "@/components/ui/hover-card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
} from "@/components/ui/item";
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverDescription,
  ResponsivePopoverHeader,
  ResponsivePopoverTitle,
  ResponsivePopoverTrigger,
} from "@/components/ui/responsive-popover";
import { useSongOptions } from "@/hooks/use-song-options";

/** One key icon for every key change, toned by how rough the change is. */
const KEY_ICON_TONES: Record<KeyTransitionLevel, string> = {
  smooth: "text-muted-foreground",
  "worth-a-look": "text-status-scheduled",
  rough: "text-destructive",
};

interface AlternateKey {
  arrangement: ArrangementOption;
  key: KeyOption;
}

/** Keys the song already has on a live arrangement, as candidates for a smoother start. */
const arrangementKeys = (
  arrangements: readonly ArrangementOption[]
): { key: MusicalKey; value: AlternateKey }[] => {
  const candidates: { key: MusicalKey; value: AlternateKey }[] = [];
  for (const arrangement of arrangements) {
    if (arrangement.archived) {
      continue;
    }
    for (const key of arrangement.keys) {
      const musicalKey = parseMusicalKey(key.startingKey ?? key.name);
      if (musicalKey !== null) {
        candidates.push({ key: musicalKey, value: { arrangement, key } });
      }
    }
  }
  return candidates;
};

const SegmentText = ({ segments }: { segments: readonly AdviceSegment[] }) => (
  <>
    {segments.map((segment, index) =>
      segment.kind === "chord" ? (
        // oxlint-disable-next-line react/no-array-index-key -- segments are a fixed sentence
        <strong key={index} className="text-foreground font-semibold">
          {segment.text}
        </strong>
      ) : (
        // oxlint-disable-next-line react/no-array-index-key -- segments are a fixed sentence
        <span key={index}>{segment.text}</span>
      )
    )}
  </>
);

interface KeyTransitionPopoverProps {
  transition: KeyTransition;
  serviceTypeId: string | null;
  songId: string | null;
  /** The song's notes, so an idea already in them shows as added. */
  notes: string;
  onChangeKey: (arrangement: ArrangementOption, key: KeyOption) => void;
  /** Adds an idea to the song's notes, for the band. */
  onAddNote: (note: string) => void;
}

/**
 * Ideas for connecting two songs, behind a warning when the key change is rough or worth a
 * look, and behind a quiet lightbulb when it is already smooth.
 */
export const KeyTransitionPopover = ({
  transition,
  serviceTypeId,
  songId,
  notes,
  onChangeKey,
  onAddNote,
}: KeyTransitionPopoverProps) => {
  const [open, setOpen] = useState(false);
  const tip = transition.level === "smooth";
  const suggestions = transitionSuggestions(transition, transition.kind);
  const { data: options } = useSongOptions(
    open && !tip ? songId : null,
    serviceTypeId
  );
  const alternates = rankAlternateKeys(
    transition,
    arrangementKeys(options?.arrangements ?? [])
  ).filter(
    (alternate, index, all) =>
      all.findIndex(
        (other) => other.key.startingKey === alternate.key.startingKey
      ) === index
  );

  if (tip && suggestions.length === 0) {
    return null;
  }

  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={
              tip
                ? `Key change from ${transition.from} to ${transition.to}: ${transition.description}. Show ideas to connect the songs.`
                : `Key change from ${transition.from} to ${transition.to}: ${transition.description}. Show ways to connect the songs.`
            }
          />
        }
      >
        <HugeiconsIcon
          icon={Key01Icon}
          strokeWidth={2}
          className={KEY_ICON_TONES[transition.level]}
        />
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent
        align="end"
        className="max-h-(--available-height) w-80 overflow-y-auto overscroll-contain"
      >
        <ResponsivePopoverHeader className="mx-4 mt-4 max-md:mx-0 max-md:mt-0">
          <ResponsivePopoverTitle>
            {transition.from} → {transition.to}
          </ResponsivePopoverTitle>
          <ResponsivePopoverDescription>
            {transition.fromTitle} into {transition.toTitle}:{" "}
            {transition.description.charAt(0).toLowerCase()}
            {transition.description.slice(1)}.
            {transition.bridgedBy === null
              ? null
              : ` ${transition.bridgedBy} gives the band room to change.`}
          </ResponsivePopoverDescription>
        </ResponsivePopoverHeader>
        {/* Touch has no hover label, so say what tapping an idea does. */}
        <p className="bg-muted text-muted-foreground mx-4 mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs pointer-fine:hidden">
          <NotebookPen className="size-3.5 shrink-0" aria-hidden />
          Tap an idea to add it to notes.
        </p>
        <ul className="mt-1 flex flex-col gap-1 p-1">
          {suggestions.map((suggestion) => {
            const note = suggestionNote(suggestion);
            const added = notes.includes(note);
            return (
              <li key={suggestion.id}>
                <HoverLabel
                  label={added ? "In notes" : "Add to notes"}
                  side="left"
                  trigger={
                    <Item
                      size="xs"
                      render={
                        <button
                          type="button"
                          aria-label={`${suggestion.title}: ${added ? "in notes" : "add to notes"}`}
                          disabled={added}
                        />
                      }
                      onClick={() => {
                        onAddNote(note);
                      }}
                    />
                  }
                >
                  <ItemContent>
                    <ItemTitle>{suggestion.title}</ItemTitle>
                    <span className="text-muted-foreground text-sm">
                      <SegmentText segments={suggestion.segments} />
                    </span>
                  </ItemContent>
                  <ItemActions className="self-start">
                    {added ? (
                      <Check className="text-muted-foreground size-3.5" />
                    ) : (
                      <NotebookPen className="text-muted-foreground size-3.5 pointer-fine:opacity-0 pointer-fine:group-hover/item:opacity-100 pointer-fine:group-focus-visible/item:opacity-100" />
                    )}
                  </ItemActions>
                </HoverLabel>
              </li>
            );
          })}
        </ul>
        {tip || alternates.length === 0 ? null : (
          <div className="flex flex-col gap-2 border-t px-4 py-3">
            <span className="text-xs font-medium">
              Or play {transition.toTitle} in
            </span>
            <div className="flex flex-wrap gap-1.5">
              {alternates.map(({ arrangement, key }) => (
                <Button
                  key={`${arrangement.id}:${key.id}`}
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    setOpen(false);
                    onChangeKey(arrangement, key);
                  }}
                >
                  {keyName(
                    parseMusicalKey(key.startingKey ?? key.name) ??
                      transition.toKey
                  )}
                  <span className="text-muted-foreground">
                    {keyOptionLabelOf(key) === (key.startingKey ?? "")
                      ? arrangement.name
                      : `${arrangement.name} · ${keyOptionLabelOf(key)}`}
                  </span>
                </Button>
              ))}
            </div>
          </div>
        )}
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
};
