import type { RegisterableHotkey } from "@tanstack/react-hotkeys";

export const SIDEBAR_TOGGLE_HOTKEY =
  "Mod+B" as const satisfies RegisterableHotkey;

export const SHORTCUTS_PALETTE_HOTKEY =
  "Mod+/" as const satisfies RegisterableHotkey;

export const PREVIOUS_PLAN_HOTKEY = "[" as const satisfies RegisterableHotkey;
export const NEXT_PLAN_HOTKEY = "]" as const satisfies RegisterableHotkey;

export const APP_SHORTCUTS = [
  {
    id: "sidebar.toggle",
    label: "Toggle sidebar",
    binding: SIDEBAR_TOGGLE_HOTKEY,
  },
  {
    id: "plan.previousPlan",
    label: "Previous plan of the same service",
    binding: PREVIOUS_PLAN_HOTKEY,
  },
  {
    id: "plan.nextPlan",
    label: "Next plan of the same service",
    binding: NEXT_PLAN_HOTKEY,
  },
  {
    id: "shortcuts.palette",
    label: "Keyboard shortcuts",
    binding: SHORTCUTS_PALETTE_HOTKEY,
  },
] as const;

/** Plan builder keys; they act on the selected run sheet row and skip text fields. */
export const PLAN_BUILDER_SHORTCUTS = [
  { id: "plan.next", label: "Next row", binding: "J" },
  { id: "plan.previous", label: "Previous row", binding: "K" },
  { id: "plan.moveDown", label: "Move row down", binding: "Alt+ArrowDown" },
  { id: "plan.moveUp", label: "Move row up", binding: "Alt+ArrowUp" },
  {
    id: "plan.details",
    label: "Edit the row's details",
    binding: "Enter",
  },
  { id: "plan.addSong", label: "Add a song", binding: "/" },
  { id: "plan.addHeader", label: "Add a header", binding: "H" },
  { id: "plan.addItem", label: "Add an item", binding: "I" },
  { id: "plan.remove", label: "Remove the row", binding: "Backspace" },
  {
    id: "plan.clear",
    label: "Leave details, then clear the selection",
    binding: "Escape",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  binding: RegisterableHotkey;
}[];

export const NEXT_SONG_SHORTCUT = {
  id: "song.next",
  label: "Next song",
  binding: "ArrowRight",
} as const satisfies {
  id: string;
  label: string;
  binding: RegisterableHotkey;
};
export const PREVIOUS_SONG_SHORTCUT = {
  id: "song.previous",
  label: "Previous song",
  binding: "ArrowLeft",
} as const satisfies {
  id: string;
  label: string;
  binding: RegisterableHotkey;
};

/** The file dialog's keys: step through the plan's songs without closing it. */
export const FILE_DIALOG_SHORTCUTS = [
  NEXT_SONG_SHORTCUT,
  PREVIOUS_SONG_SHORTCUT,
] as const satisfies readonly {
  id: string;
  label: string;
  binding: RegisterableHotkey;
}[];
