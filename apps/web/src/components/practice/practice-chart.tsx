import type {
  ChartLine,
  ChartSection,
  ChartSegment,
} from "@pcobooster/planning-center-models/chord-chart-lines";
import type { Ref } from "react";

import type { ChartTextSize } from "@/lib/practice";
import { cn } from "@/lib/utils";

interface ChartScale {
  /** Lyrics and comments. */
  readonly text: string;
  /** Chords, a step smaller so they sit over the words without crowding them. */
  readonly chord: string;
  readonly heading: string;
}

const chartScales: Record<ChartTextSize, ChartScale> = {
  sm: { text: "text-sm", chord: "text-xs", heading: "text-xs" },
  base: { text: "text-base", chord: "text-sm", heading: "text-xs" },
  lg: { text: "text-lg", chord: "text-base", heading: "text-sm" },
  xl: { text: "text-xl", chord: "text-lg", heading: "text-sm" },
  "2xl": { text: "text-2xl", chord: "text-xl", heading: "text-base" },
};

/** A gap the width of a space, so an empty chord or lyric still holds its line. */
const SPACE = " ";

const Segment = ({
  segment,
  chordClassName,
}: {
  segment: ChartSegment;
  chordClassName: string;
}) => (
  <span className="inline-flex flex-col">
    <span
      className={cn(
        "text-status-info leading-tight font-semibold whitespace-pre",
        chordClassName
      )}
    >
      {segment.chord === null || segment.chord === ""
        ? SPACE
        : `${segment.chord}${SPACE}`}
    </span>
    <span className="whitespace-pre-wrap">
      {segment.text === "" ? SPACE : segment.text}
    </span>
  </span>
);

/** Read aloud as words with each chord named before them, not as a column of fragments. */
const spokenLyric = (segments: readonly ChartSegment[]): string =>
  segments
    .map((segment) =>
      segment.chord === null || segment.chord === ""
        ? segment.text
        : `(${segment.chord}) ${segment.text}`
    )
    .join("");

const Line = ({
  line,
  underChords,
  scale,
}: {
  line: ChartLine;
  /** A lyric under a chord line keeps its columns, so the chords stay over their words. */
  underChords: boolean;
  scale: ChartScale;
}) => {
  if (line.kind === "chords") {
    return (
      <p
        className={cn(
          "text-status-info font-mono leading-tight font-semibold whitespace-pre",
          scale.chord
        )}
      >
        {line.text}
      </p>
    );
  }
  if (line.kind === "comment") {
    return <p className="text-muted-foreground italic">{line.text}</p>;
  }
  if (line.kind === "lyric") {
    const hasChords = line.segments.some((segment) => segment.chord !== null);
    if (!hasChords) {
      return (
        <p
          className={cn(
            "whitespace-pre-wrap",
            underChords && ["font-mono whitespace-pre", scale.chord]
          )}
        >
          {line.segments.map((segment) => segment.text).join("")}
        </p>
      );
    }
    return (
      <p
        className="flex flex-wrap items-end"
        aria-label={spokenLyric(line.segments)}
      >
        {line.segments.map((segment, position) => (
          <Segment
            // Segments have no identity but their place in the line.
            key={`segment-${String(position)}`}
            segment={segment}
            chordClassName={scale.chord}
          />
        ))}
      </p>
    );
  }
  if (line.kind === "heading") {
    return null;
  }
  return <div aria-hidden className="h-[0.6em]" />;
};

/** Keys for sections from their headings: the second `CHORUS` is `CHORUS-2`. */
const sectionKeys = (sections: readonly ChartSection[]) => {
  const seen = new Map<string, number>();
  return sections.map((section, position) => {
    const name = section.heading ?? "opening";
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return { section, position, key: `${name}-${String(count)}` };
  });
};

/**
 * A chart as text: sections flow into as many columns as the width holds, and a section never
 * splits across two. `sectionRef` registers each section so a sequence entry can jump to it.
 */
export const PracticeChart = ({
  sections,
  textSize,
  highlighted,
  sectionRef,
}: {
  sections: readonly ChartSection[];
  textSize: ChartTextSize;
  /** The section just jumped to, shown for a moment so the eye lands on it. */
  highlighted: number | null;
  sectionRef: (index: number) => Ref<HTMLElement>;
}) => (
  <div
    className={cn(
      "gap-12 leading-snug sm:columns-[18rem]",
      chartScales[textSize].text
    )}
  >
    {sectionKeys(sections).map(({ section, key, position }) => (
      <section
        key={key}
        ref={sectionRef(position)}
        data-highlighted={highlighted === position}
        className="data-[highlighted=true]:bg-muted -mx-2 mb-5 scroll-mt-4 break-inside-avoid overflow-x-auto overscroll-x-contain rounded-lg px-2 py-1"
      >
        {section.heading === null ? null : (
          <h3
            className={cn(
              "text-muted-foreground mb-1 font-semibold tracking-wider uppercase",
              chartScales[textSize].heading
            )}
          >
            {section.heading}
          </h3>
        )}
        {section.lines.map((line, at) => (
          <Line
            // Lines have no identity but their place in the section.
            key={`line-${String(at)}`}
            line={line}
            underChords={section.lines[at - 1]?.kind === "chords"}
            scale={chartScales[textSize]}
          />
        ))}
      </section>
    ))}
  </div>
);
