import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import { useRef, useState } from "react";

import type { PlanFileDialogState } from "@/lib/plan-file-dialog";

/**
 * The file dialog's state on the plan. `onShow` hears each item the dialog moves to, so
 * the run sheet follows along and closing lands on the song last open. `focusTargetOf`
 * names where focus returns for an item when the file that opened the dialog is gone,
 * as it is after stepping to another song.
 */
export const usePlanFileDialog = (
  onShow: (itemId: string) => void,
  focusTargetOf: (itemId: string) => HTMLElement | null
) => {
  const [state, setState] = useState<PlanFileDialogState | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const lastItemId = useRef<string | null>(null);
  const handleChange = (next: PlanFileDialogState | null) => {
    setState(next);
    if (next !== null) {
      lastItemId.current = next.itemId;
      onShow(next.itemId);
    }
  };
  return {
    state,
    handleChange,
    /** Opens an item's files on one of them. */
    openFor: (itemId: string) => (file: PlanFile) => {
      const focused = document.activeElement;
      opener.current = focused instanceof HTMLElement ? focused : null;
      handleChange({ itemId, file });
    },
    /** Where focus goes on close: the opener while it's still on the page. */
    finalFocus: (): HTMLElement | true => {
      if (opener.current?.isConnected === true) {
        return opener.current;
      }
      const itemId = lastItemId.current;
      return (itemId === null ? null : focusTargetOf(itemId)) ?? true;
    },
  };
};

export type PlanFileDialogControl = ReturnType<typeof usePlanFileDialog>;
