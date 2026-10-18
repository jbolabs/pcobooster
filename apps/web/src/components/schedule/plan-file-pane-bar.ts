import { cn } from "@/lib/utils";

/**
 * The top bar of each file pane. Both share it so the list toggle sits on the same line
 * in either. Only a bar at the top of the screen clears the phone's status bar; below a
 * dialog header it doesn't need to. `insetStart` leaves room on desktop for the list toggle.
 */
export const paneBarClassName = ({
  atTop,
  insetStart = false,
}: {
  atTop: boolean;
  insetStart?: boolean;
}) =>
  cn(
    "flex min-h-12 items-center gap-1 px-3 pb-2",
    atTop ? "pt-safe-2" : "pt-2",
    insetStart && "sm:pl-12"
  );
