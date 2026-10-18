import { cn } from "cn";
import * as React from "react";

type HighlightedTextareaProps = Omit<
  React.ComponentProps<"textarea">,
  "value" | "children"
> & {
  value: string;
  /** Colored copy of `value`. It must keep every character so the layers stay aligned. */
  highlight: React.ReactNode;
};

/**
 * Metrics both layers share; any difference drifts the highlight off the caret. Lines never
 * wrap, so a chord line stays over the lyric line it belongs to; long lines scroll sideways.
 * Both keep a scrollbar gutter so the textarea's scrollbars cannot shift only one of them.
 * Touch screens get 16px text, below which iOS zooms the page when the text box takes focus.
 */
const LAYER_CLASS =
  "absolute inset-0 m-0 size-full border-0 px-4 py-3 font-mono text-base leading-6 tracking-normal whitespace-pre [scrollbar-gutter:stable] [tab-size:4] md:pointer-fine:text-[13px]";

/** A trailing newline needs a character after it to take up a line. */
const TRAILING_LINE_FILLER = "\u200B";

/**
 * A plain-text editor with syntax coloring: a transparent textarea over a highlighted
 * copy of its text. The textarea keeps native editing, undo, and selection.
 */
const HighlightedTextarea = ({
  className,
  value,
  highlight,
  onScroll,
  ref,
  ...props
}: HighlightedTextareaProps) => {
  const highlightRef = React.useRef<HTMLDivElement>(null);

  const syncScroll = (event: React.UIEvent<HTMLTextAreaElement>) => {
    const layer = highlightRef.current;
    if (layer !== null) {
      layer.scrollTop = event.currentTarget.scrollTop;
      layer.scrollLeft = event.currentTarget.scrollLeft;
    }
    onScroll?.(event);
  };

  return (
    <div
      data-slot="highlighted-textarea"
      className={cn(
        "bg-input/30 focus-within:border-ring focus-within:ring-ring/30 relative min-h-0 overflow-hidden rounded-2xl border border-transparent focus-within:ring-3",
        className
      )}
    >
      <div
        ref={highlightRef}
        aria-hidden
        className={cn(LAYER_CLASS, "text-foreground overflow-hidden")}
      >
        {highlight}
        {TRAILING_LINE_FILLER}
      </div>
      <textarea
        ref={ref}
        data-slot="highlighted-textarea-input"
        value={value}
        spellCheck={false}
        wrap="off"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        onScroll={syncScroll}
        className={cn(
          LAYER_CLASS,
          "caret-foreground selection:bg-primary/25 placeholder:text-muted-foreground resize-none overflow-auto overscroll-contain bg-transparent text-transparent outline-none"
        )}
        {...props}
      />
    </div>
  );
};

export { HighlightedTextarea };
