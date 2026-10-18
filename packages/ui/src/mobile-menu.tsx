import { Menu, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/**
 * The phone menu shared by marketing and the product (`@pcobooster/ui/mobile-menu`): a full-screen
 * page-colored overlay that fades in under a pinned header. Every entry rolls in
 * top to bottom and rolls back out bottom to top. Each app owns its header and button primitives; this package owns
 * the open state, the overlay, and the motion.
 *
 * Each app's stylesheet imports `@pcobooster/ui/mobile-menu.css` and
 * `@source`s this package for its Tailwind utilities.
 */

export interface MobileMenuState {
  open: boolean;
  setOpen: (open: boolean) => void;
  handleToggle: () => void;
  handleClose: () => void;
}

/** Open state that locks page scroll and closes on Escape while open. */
export const useMobileMenu = (): MobileMenuState => {
  const [open, setOpen] = useState(false);
  const handleToggle = useCallback(() => {
    setOpen((current) => !current);
  }, []);
  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    if (open) {
      root.style.overflow = "hidden";
      document.addEventListener("keydown", closeOnEscape);
    }
    return () => {
      if (open) {
        root.style.overflow = "";
        document.removeEventListener("keydown", closeOnEscape);
      }
    };
  }, [open]);

  return { open, setOpen, handleToggle, handleClose };
};

/** The menu button's glyph: three lines while closed, an X while open. */
export const MobileMenuIcon = ({ open }: { open: boolean }) =>
  open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />;

const ITEM_DELAY_MS = 20;
/** Entries past this share the last delay, so long menus still land fast. */
const MAX_STAGGER_STEPS = 6;
const ITEM_EXIT_DELAY_MS = 10;

/**
 * The overlay. Render it beside the app's pinned header, never inside it, and stack it
 * just under the header with `className` (a z-index); `children` fill the screen below the
 * status bar. Its enter and exit motion lives in `@pcobooster/ui/mobile-menu.css`, which each app imports.
 *
 * Safari 26 draws its toolbar edges from the fixed or sticky element about the viewport's
 * size at each edge (WebKit `LocalFrameView::fixedContainerEdges`): a backdrop filter there
 * fills the area under its bottom bar with a solid color, a hard line above the bar while
 * the menu is open. So the surface is opaque page color with no filter, and it runs past the
 * bottom of the screen: Safari skips fixed layers taller than 105% of the viewport, and with
 * no sticky ancestor it keeps its glass over the menu as over any page. The content sits on
 * an absolute panel the visible viewport's height.
 */
export const MobileMenuOverlay = ({
  id,
  open,
  className,
  children,
}: {
  id: string;
  open: boolean;
  className?: string;
  children: ReactNode;
}) => (
  <div
    id={id}
    data-slot="mobile-menu-overlay"
    inert={!open}
    data-open={open ? "" : undefined}
    className={[
      "bg-background fixed inset-x-0 top-0 h-[125lvh] md:hidden",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
  >
    <div
      data-slot="mobile-menu-panel"
      className="absolute inset-x-0 top-0 h-dvh"
    >
      {children}
    </div>
  </div>
);

type MenuItemStyle = CSSProperties & {
  "--menu-item-delay": string;
  "--menu-item-exit-delay": string;
};

/**
 * One menu entry; `index` (of `count`) staggers it so the list cascades in
 * from the top and lifts back out from the bottom. `as` renders a `div` outside lists.
 */
export const MobileMenuItem = ({
  index,
  count,
  as: Element = "li",
  children,
}: {
  index: number;
  count: number;
  as?: "li" | "div";
  children: ReactNode;
}) => {
  const style: MenuItemStyle = {
    "--menu-item-delay": `${Math.min(index, MAX_STAGGER_STEPS) * ITEM_DELAY_MS}ms`,
    "--menu-item-exit-delay": `${Math.max(0, count - 1 - index) * ITEM_EXIT_DELAY_MS}ms`,
  };
  return (
    <Element style={style} data-slot="mobile-menu-item">
      {children}
    </Element>
  );
};
