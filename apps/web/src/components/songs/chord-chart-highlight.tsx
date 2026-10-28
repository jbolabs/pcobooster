import {
  isChordLine,
  isChordToken,
  isSectionHeading,
} from "@pcobooster/planning-center-models/chord-chart";
import { isChartTextStyle } from "@pcobooster/planning-center-models/chord-chart-style";
import type { ChartTextStyle } from "@pcobooster/planning-center-models/chord-chart-style";
import { cn } from "cn";
import type { ReactNode } from "react";

const CODE_LINE_PATTERN =
  /^\s*(?:\{\{.*\}\}|COLUMN_BREAK|PAGE_BREAK|(?:TRANSPOSE|REDEFINE)\s+KEY\s+[+-]?\s*\d+)\s*$/iu;
const NOTE_LINE_PATTERN = /^\s*\{.*\}\s*$/u;
const INLINE_CHORD_PATTERN = /\[[^\]\n]*\]/gu;
const NON_SPACE_PATTERN = /\S+/gu;
const STYLE_TAG_PATTERN = /<(?<tag>[biu])>(?<inner>.*?)<\/\k<tag>>/gu;

/**
 * Bold strokes the glyphs and italic slants them, since real bold and italic faces are wider
 * or narrower and would push the colored copy off the caret.
 */
const STYLE_TAG_CLASS = {
  b: "faux-bold",
  i: "inline-block -skew-x-12",
  u: "underline",
} as const satisfies Record<ChartTextStyle, string>;

/** Keys are character offsets into the chart, which identify each piece uniquely. */
const highlightMatches = (
  line: string,
  lineOffset: number,
  pattern: RegExp,
  className: (match: string) => string | null
): ReactNode[] => {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    const matchClass = className(match[0]);
    if (matchClass !== null) {
      parts.push(
        line.slice(cursor, match.index),
        <span key={lineOffset + match.index} className={matchClass}>
          {match[0]}
        </span>
      );
      cursor = match.index + match[0].length;
    }
  }
  parts.push(line.slice(cursor));
  return parts;
};

/** Inline chords, inside Services' `<b>`, `<i>`, and `<u>` tags when a lyric has them. */
const highlightLyric = (
  text: string,
  offset: number,
  chordClass: string
): ReactNode[] => {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(STYLE_TAG_PATTERN)) {
    const tag = match.groups?.tag ?? "";
    if (!isChartTextStyle(tag)) {
      continue;
    }
    const inner = match.groups?.inner ?? "";
    const start = offset + match.index;
    const innerStart = start + tag.length + 2;
    parts.push(
      ...highlightMatches(
        text.slice(cursor, match.index),
        offset + cursor,
        INLINE_CHORD_PATTERN,
        () => chordClass
      ),
      <span key={`${start}:open`} className="text-muted-foreground">
        {`<${tag}>`}
      </span>,
      <span key={`${start}:inner`} className={STYLE_TAG_CLASS[tag]}>
        {highlightLyric(inner, innerStart, chordClass)}
      </span>,
      <span key={`${start}:close`} className="text-muted-foreground">
        {`</${tag}>`}
      </span>
    );
    cursor = match.index + match[0].length;
  }
  parts.push(
    ...highlightMatches(
      text.slice(cursor),
      offset + cursor,
      INLINE_CHORD_PATTERN,
      () => chordClass
    )
  );
  return parts;
};

const highlightLine = (
  line: string,
  offset: number,
  chordClassName: string
): ReactNode => {
  if (CODE_LINE_PATTERN.test(line)) {
    return <span className="text-chart-4">{line}</span>;
  }
  if (NOTE_LINE_PATTERN.test(line)) {
    return <span className="text-muted-foreground">{line}</span>;
  }
  if (isSectionHeading(line)) {
    return <span className="faux-bold">{line}</span>;
  }
  const chordClass = cn(chordClassName, "faux-bold");
  if (isChordLine(line)) {
    // Services colors the chords and leaves bar lines, pushes, and counts plain.
    return highlightMatches(line, offset, NON_SPACE_PATTERN, (token) =>
      isChordToken(token) ? chordClass : null
    );
  }
  return highlightLyric(line, offset, chordClass);
};

/**
 * Colors a chart for the editor without changing a single character, styled as Services
 * prints it: chords bold in the chart's chord color, section headings bold, and styled text
 * in its style. Bold is `faux-bold`, since wider bold glyphs would push the colored copy off
 * the caret.
 */
export const highlightChordChart = (
  text: string,
  chordClassName: string
): ReactNode[] => {
  const lines: ReactNode[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const isLast = offset + line.length >= text.length;
    lines.push(
      <span key={offset}>
        {highlightLine(line, offset, chordClassName)}
        {isLast ? null : "\n"}
      </span>
    );
    offset += line.length + 1;
  }
  return lines;
};
