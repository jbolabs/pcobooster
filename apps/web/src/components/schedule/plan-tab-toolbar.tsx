import type { RegisterableHotkey } from "@tanstack/react-hotkeys";
import { Music2, Plus, Type } from "lucide-react";
import type { ReactNode } from "react";

import { HotkeyChord } from "@/components/hotkey-chord";
import { Button } from "@/components/ui/button";
import { HoverLabel } from "@/components/ui/hover-card";
import { PLAN_BUILDER_SHORTCUTS } from "@/lib/app-hotkeys";

interface PlanTabToolbarProps {
  isCreatingBasicItem?: boolean;
  disabled?: boolean;
  onAddSong: () => void;
  onAddHeader: () => void;
  onAddItem: () => void;
}

const bindingOf = (id: "plan.addSong" | "plan.addHeader" | "plan.addItem") =>
  PLAN_BUILDER_SHORTCUTS.find((entry) => entry.id === id)?.binding ?? null;

/** A toolbar button whose hover label names it and shows its shortcut. */
const ShortcutButton = ({
  label,
  binding,
  render,
  children,
}: {
  label: string;
  binding: RegisterableHotkey | null;
  render: React.ReactElement;
  children: ReactNode;
}) => (
  <HoverLabel
    label={
      <span className="inline-flex items-center gap-2">
        {label}
        {binding === null ? null : <HotkeyChord binding={binding} id={label} />}
      </span>
    }
    trigger={render}
  >
    {children}
  </HoverLabel>
);

/**
 * The plan's add actions, floating over the bottom of the run
 * sheet so they stay in reach while scrolling.
 */
export const PlanTabToolbar = ({
  isCreatingBasicItem = false,
  disabled = false,
  onAddSong,
  onAddHeader,
  onAddItem,
}: PlanTabToolbarProps) => (
  <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4 max-md:fixed max-md:bottom-[calc(env(safe-area-inset-bottom)+1rem)]">
    <div
      role="toolbar"
      aria-label="Add to plan"
      data-plan-toolbar
      className="bg-popover text-popover-foreground ring-foreground/5 dark:ring-foreground/10 pointer-events-auto flex items-center gap-1 rounded-full p-1 shadow-lg ring-1"
    >
      <ShortcutButton
        label="Add a header"
        binding={bindingOf("plan.addHeader")}
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onAddHeader}
            disabled={disabled || isCreatingBasicItem}
          />
        }
      >
        <Type className="size-4 opacity-70" />
        Header
      </ShortcutButton>
      <ShortcutButton
        label="Add an item"
        binding={bindingOf("plan.addItem")}
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onAddItem}
            disabled={disabled || isCreatingBasicItem}
          />
        }
      >
        <Plus className="size-4 opacity-70" />
        Item
      </ShortcutButton>
      <ShortcutButton
        label="Add a song"
        binding={bindingOf("plan.addSong")}
        render={
          <Button
            type="button"
            size="sm"
            onClick={onAddSong}
            disabled={disabled}
          />
        }
      >
        <Music2 className="size-4" />
        Add song
      </ShortcutButton>
    </div>
  </div>
);
