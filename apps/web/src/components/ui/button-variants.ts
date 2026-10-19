import { cva } from "class-variance-authority";

/**
 * A 44px tap area centered on the button, for sizes drawn smaller than a fingertip on touch
 * screens. It's invisible and doesn't move layout, so dense rows keep their look.
 */
export const coarseHitArea =
  "pointer-coarse:after:absolute pointer-coarse:after:top-1/2 pointer-coarse:after:left-1/2 pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 pointer-coarse:after:-translate-1/2";

/**
 * Hover colors only reach precise pointers (the gated `hover:` variant), so each variant
 * repeats its hover color on `active:`: a finger gets the same instant press feedback.
 * Touch screens have no hover to reveal a ghost button, so `ghost` and `ghost-destructive`
 * keep a faint fill there and darken it on press.
 *
 * Every size grows on touch screens (`pointer-coarse:`), where people tap with a finger:
 * `default`, `lg`, `icon`, and `icon-lg` draw at 44px, the smaller sizes one step up with a
 * 44px tap area. A mouse keeps the compact desktop sizes.
 */
const buttonVariants = cva(
  "group/button focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 relative inline-flex shrink-0 items-center justify-center rounded-4xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/80 active:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-input/30 dark:active:bg-input/30 dark:bg-transparent",
        input:
          "bg-input/50 text-foreground hover:bg-input/50 aria-expanded:bg-input/50 focus-visible:border-ring dark:hover:bg-input/50 border-transparent font-normal",
        secondary:
          "bg-secondary text-secondary-foreground aria-expanded:bg-secondary aria-expanded:text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] active:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
        ghost:
          "hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50 dark:active:bg-muted/50 pointer-coarse:bg-muted/50 dark:pointer-coarse:bg-muted/30",
        "ghost-destructive":
          "text-destructive hover:bg-destructive/10 hover:text-destructive active:bg-destructive/10 aria-expanded:bg-destructive/10 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:hover:bg-destructive/20 dark:active:bg-destructive/20 pointer-coarse:bg-destructive/5 dark:pointer-coarse:bg-destructive/10",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 active:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:active:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 pointer-coarse:h-11 pointer-coarse:px-4",
        xs: `h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 pointer-coarse:h-8 pointer-coarse:px-3 pointer-coarse:text-sm [&_svg:not([class*='size-'])]:size-3 pointer-coarse:[&_svg:not([class*='size-'])]:size-4 ${coarseHitArea}`,
        sm: `h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 pointer-coarse:h-10 pointer-coarse:px-3.5 ${coarseHitArea}`,
        lg: "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 pointer-coarse:h-12",
        icon: "size-9 pointer-coarse:size-11",
        "icon-xs": `size-6 pointer-coarse:size-8 [&_svg:not([class*='size-'])]:size-3 pointer-coarse:[&_svg:not([class*='size-'])]:size-4 ${coarseHitArea}`,
        "icon-sm": `size-8 pointer-coarse:size-10 ${coarseHitArea}`,
        "icon-lg": "size-10 pointer-coarse:size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export { buttonVariants };
