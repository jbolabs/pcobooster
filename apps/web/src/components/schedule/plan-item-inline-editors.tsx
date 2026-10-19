import { parseLengthText } from "@pcobooster/planning-center-models/plan-item-draft";
import {
  formatDuration,
  keyLabelOf,
  keyOptionPartsOf,
} from "@pcobooster/planning-center-models/plan-overview";
import type { KeyTransition } from "@pcobooster/planning-center-models/plan-set-insights";
import type {
  ArrangementOption,
  KeyOption,
  PlanItem,
} from "@pcobooster/planning-center-models/types";
import { useState } from "react";

import { KeyTransitionPopover } from "@/components/schedule/key-transition-popover";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverTrigger,
} from "@/components/ui/responsive-popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useDraftPopover } from "@/hooks/use-persist-on-close-popover";
import { useSongOptions } from "@/hooks/use-song-options";

/** The key first, then whose key it is or how it is sung, on its own line. */
const KeyOptionContent = ({ keyOption }: { keyOption: KeyOption }) => {
  const { label, description } = keyOptionPartsOf(keyOption);
  return (
    <span className="flex min-w-0 flex-col">
      <span className="tabular-nums">{label}</span>
      {description === null ? null : (
        <span className="text-muted-foreground text-xs font-normal">
          {description}
        </span>
      )}
    </span>
  );
};

interface SongKeyPickerProps {
  item: PlanItem;
  serviceTypeId: string | null;
  /** The change from the previous song's key: rough ones are flagged, smooth ones get ideas. */
  transition: KeyTransition | null;
  onChange: (arrangement: ArrangementOption, key: KeyOption) => void;
  onAddNote: (note: string) => void;
}

/** The song's key as a chip; picking another key or arrangement saves right away. */
export const SongKeyPicker = ({
  item,
  serviceTypeId,
  transition,
  onChange,
  onAddNote,
}: SongKeyPickerProps) => {
  const [open, setOpen] = useState(false);
  const { data: options, isLoading } = useSongOptions(
    open ? (item.song?.id ?? null) : null,
    serviceTypeId
  );
  const label =
    item.key === null ? null : (keyLabelOf(item.key) ?? item.key.name);
  const arrangements =
    options?.arrangements.filter((arrangement) => !arrangement.archived) ?? [];

  return (
    <span className="flex items-center gap-1">
      {transition === null ? null : (
        <KeyTransitionPopover
          transition={transition}
          serviceTypeId={serviceTypeId}
          songId={item.song?.id ?? null}
          notes={item.description}
          onChangeKey={onChange}
          onAddNote={onAddNote}
        />
      )}
      <ResponsivePopover open={open} onOpenChange={setOpen}>
        <ResponsivePopoverTrigger
          render={
            <Button
              type="button"
              variant={label === null ? "ghost" : "outline"}
              size="xs"
              aria-label={
                label === null
                  ? `Choose a key for ${item.title}`
                  : `Key ${label}, change key for ${item.title}`
              }
            />
          }
        >
          {label ?? <span className="text-status-scheduled">No key</span>}
        </ResponsivePopoverTrigger>
        <ResponsivePopoverContent
          title={`Key for ${item.title}`}
          showTitle
          align="end"
          className="w-72"
        >
          <Command>
            <CommandList>
              {isLoading && options === undefined ? (
                <div className="flex flex-col gap-2 p-3" aria-busy>
                  <Skeleton variant="text" className="h-3.5 w-24" />
                  <Skeleton variant="text" className="h-3.5 w-32" />
                </div>
              ) : (
                <CommandEmpty>No arrangements with keys.</CommandEmpty>
              )}
              {arrangements.map((arrangement) => (
                <CommandGroup key={arrangement.id} heading={arrangement.name}>
                  {arrangement.keys.map((key) => (
                    <CommandItem
                      key={key.id}
                      value={`${arrangement.id}:${key.id}`}
                      data-checked={
                        item.arrangement?.id === arrangement.id &&
                        item.key?.id === key.id
                      }
                      onSelect={() => {
                        setOpen(false);
                        onChange(arrangement, key);
                      }}
                    >
                      <KeyOptionContent keyOption={key} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </ResponsivePopoverContent>
      </ResponsivePopover>
    </span>
  );
};

const lengthText = (length: number | null) =>
  length === null || length <= 0 ? "" : (formatDuration(length) ?? "");

interface ItemLengthEditorProps {
  item: PlanItem;
  onChange: (length: number | null) => void;
  onInvalid: (message: string) => void;
}

/** The item's length; typing "4:35" and leaving the field saves it. */
export const ItemLengthEditor = ({
  item,
  onChange,
  onInvalid,
}: ItemLengthEditorProps) => {
  const current = lengthText(item.length);
  const {
    draft,
    setDraft,
    open,
    handleOpenChange,
    closeAndPersist,
    contentRef,
  } = useDraftPopover({
    value: current,
    onPersist: (text) => {
      const parsed = parseLengthText(text);
      if (parsed.error !== null) {
        onInvalid(parsed.error);
        return;
      }
      onChange(parsed.length);
    },
  });

  return (
    <ResponsivePopover open={open} onOpenChange={handleOpenChange}>
      <ResponsivePopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={
              current === ""
                ? `Set length for ${item.title}`
                : `Length ${current}, change length for ${item.title}`
            }
          />
        }
      >
        <span className="text-muted-foreground tabular-nums">
          {current === "" ? "-:--" : current}
        </span>
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent
        ref={contentRef}
        title={`Length of ${item.title}`}
        showTitle
        align="end"
        className="w-44"
      >
        <form
          className="p-2 max-md:px-3 max-md:pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            closeAndPersist();
          }}
        >
          <Input
            aria-label="Length"
            placeholder="m:ss"
            // Minutes and seconds need a colon, which the digits-only keypad lacks.
            autoComplete="off"
            enterKeyHint="done"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
        </form>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
};
