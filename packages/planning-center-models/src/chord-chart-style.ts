/**
 * Services' text styles: `<b>bold</b>`, `<i>italic</i>`, and `<u>underline</u>` in a chart.
 * The editor toggles them around a selection, as a word processor's Bold and Italic do.
 */

export const CHART_TEXT_STYLES = ["b", "i", "u"] as const;

export type ChartTextStyle = (typeof CHART_TEXT_STYLES)[number];

export const isChartTextStyle = (tag: string): tag is ChartTextStyle =>
  CHART_TEXT_STYLES.some((style) => style === tag);

/** One edit to a chart's text and the selection to leave after it. */
export interface ChartTextEdit {
  /** Replace `text.slice(from, to)` with `insert`. */
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

/**
 * Wraps the selection in `style`'s tags, or removes them when they already surround it
 * (just outside the selection, or as its first and last characters). An empty selection
 * gets an empty pair with the caret between, so typing continues in the style.
 */
export const toggleChartTextStyle = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
  style: ChartTextStyle
): ChartTextEdit => {
  const open = `<${style}>`;
  const close = `</${style}>`;
  const selected = text.slice(selectionStart, selectionEnd);
  const wrappedOutside =
    text.slice(selectionStart - open.length, selectionStart) === open &&
    text.slice(selectionEnd, selectionEnd + close.length) === close;
  if (wrappedOutside) {
    return {
      from: selectionStart - open.length,
      to: selectionEnd + close.length,
      insert: selected,
      selectionStart: selectionStart - open.length,
      selectionEnd: selectionEnd - open.length,
    };
  }
  const wrappedInside =
    selected.length >= open.length + close.length &&
    selected.startsWith(open) &&
    selected.endsWith(close);
  if (wrappedInside) {
    const inner = selected.slice(open.length, -close.length);
    return {
      from: selectionStart,
      to: selectionEnd,
      insert: inner,
      selectionStart,
      selectionEnd: selectionStart + inner.length,
    };
  }
  return {
    from: selectionStart,
    to: selectionEnd,
    insert: `${open}${selected}${close}`,
    selectionStart: selectionStart + open.length,
    selectionEnd: selectionEnd + open.length,
  };
};
