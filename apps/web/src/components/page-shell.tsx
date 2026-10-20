import type { ReactNode, Ref } from "react";

import { cn } from "@/lib/utils";

/**
 * The one centered column every product page sits in. It spans the whole inset and centers
 * its content with `--page-gutter` padding (set by the app shell), so the column's scroll box,
 * and its scrollbar, reach the inset edge. Pages never pick their own width:
 * `lint/page-width.test.ts` rejects `mx-auto` with a `max-w-*` container width anywhere else.
 */
const pageColumnClassName = "w-full px-(--page-gutter)";

type PageLayout = "scroll" | "fill" | "center";

const pageLayoutClassName: Record<PageLayout, string> = {
  // The column scrolls on desktop; phones scroll the window.
  scroll: "md:overflow-y-auto md:overscroll-contain",
  // Fixed chrome at the top; the page scrolls inside one or more `PageScrollArea`s.
  fill: "",
  // Empty, error, and not-found states.
  center: "items-center justify-center text-center",
};

/**
 * Layout for everything rendered in the sidebar inset: a full-height `main` holding one
 * centered column. It takes no width or class overrides so every page renders at the same
 * width; `lint/page-shell.test.ts` rejects any other `main` in the product.
 */
export const PageShell = ({
  children,
  label,
  busy = false,
  layout = "scroll",
}: {
  children: ReactNode;
  /** Accessible name for the landmark, used by loading fallbacks. */
  label?: string;
  busy?: boolean;
  layout?: PageLayout;
}) => (
  <main
    className="bg-background flex flex-1 flex-col md:h-full md:min-h-0 md:overflow-hidden"
    aria-busy={busy || undefined}
    aria-label={label}
  >
    <div
      className={cn(
        pageColumnClassName,
        "pb-safe-4 flex flex-1 flex-col gap-3 pt-1 md:min-h-0 md:py-4",
        pageLayoutClassName[layout]
      )}
    >
      {children}
    </div>
  </main>
);

/**
 * A scrolling region inside a `layout="fill"` page. It stretches out to the inset edges so
 * its scrollbar sits there, and pads its content back into the page column. Desktop scrolls
 * here; phones scroll the window, so sticky headers inside still stick to the phone screen.
 */
export const PageScrollArea = ({
  children,
  axis = "y",
  besidePane = false,
  contained = false,
  ref,
}: {
  children: ReactNode;
  /** `both` also scrolls sideways from `md` up, for boards wider than the page. */
  axis?: "y" | "both";
  /** Sits right of a side pane on wide screens, so it reaches only the right edge there. */
  besidePane?: boolean;
  /** Keeps a nested split pane inside its column instead of extending to the shell edges. */
  contained?: boolean;
  ref?: Ref<HTMLDivElement>;
}) => (
  <div
    ref={ref}
    className={cn(
      "flex flex-col md:min-h-0 md:flex-1 md:overscroll-contain",
      !contained && "-mx-(--page-gutter)",
      axis === "both" ? "md:overflow-auto" : "md:overflow-y-auto",
      besidePane && "lg:ml-0"
    )}
  >
    <div
      className={cn(
        !contained && "px-(--page-gutter)",
        // Phones stack boards into one column, so only wider screens size to the content.
        axis === "both"
          ? "w-full min-w-0 md:w-fit md:min-w-full"
          : "w-full min-w-0",
        besidePane && "lg:pl-0"
      )}
    >
      {children}
    </div>
  </div>
);
