import {
  isChordLine,
  isChordToken,
  isSectionHeading,
} from "@pcobooster/planning-center-models/chord-chart";
import { cn } from "cn";
import type { ReactNode } from "react";

const CODE_LINE_PATTERN =
  /^\s*(?:\{\{.*\}\}|COLUMN_BREAK|PAGE_BREAK|(?:TRANSPOSE|REDEFINE)\s+KEY\s+[+-]?\s*\d+)\s*$/iu;
const NOTE_LINE_PATTERN = /^\s*\{.*\}\s*$/u;
const INLINE_CHORD_PATTERN = /\[[^\]\n]*\]/gu;
const NON_SPACE_PATTERN = /\S+/gu;

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
  return highlightMatches(line, offset, INLINE_CHORD_PATTERN, () => chordClass);
};

/**
 * Colors a chart for the editor without changing a single character, styled as Services
 * prints it: chords bold in the chart's chord color, section headings bold. Bold is
 * `faux-bold`, since wider bold glyphs would push the colored copy off the caret.
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
