import { toggleChartTextStyle } from "@pcobooster/planning-center-models/chord-chart-style";
import type { ChartTextEdit } from "@pcobooster/planning-center-models/chord-chart-style";
import { describe, expect, it } from "vitest";

const apply = (text: string, edit: ChartTextEdit) => ({
  text: `${text.slice(0, edit.from)}${edit.insert}${text.slice(edit.to)}`,
  selected: [edit.selectionStart, edit.selectionEnd],
});

describe(toggleChartTextStyle, () => {
  it("wraps the selection and keeps the same words selected", () => {
    const text = "[G]Amazing grace how sweet";
    expect(apply(text, toggleChartTextStyle(text, 3, 16, "b"))).toStrictEqual({
      text: "[G]<b>Amazing grace</b> how sweet",
      selected: [6, 19],
    });
  });

  it("removes tags just outside the selection, which is what wrapping leaves selected", () => {
    const text = "[G]<b>Amazing grace</b> how sweet";
    expect(apply(text, toggleChartTextStyle(text, 6, 19, "b"))).toStrictEqual({
      text: "[G]Amazing grace how sweet",
      selected: [3, 16],
    });
  });

  it("removes tags selected along with the words", () => {
    const text = "Softly <i>(x2)</i>";
    expect(apply(text, toggleChartTextStyle(text, 7, 18, "i"))).toStrictEqual({
      text: "Softly (x2)",
      selected: [7, 11],
    });
  });

  it("wraps a selection of separately bolded words instead of unpairing their tags", () => {
    const text = "<b>Amazing</b> <b>grace</b>";
    expect(apply(text, toggleChartTextStyle(text, 0, 27, "b"))).toStrictEqual({
      text: "<b><b>Amazing</b> <b>grace</b></b>",
      selected: [3, 30],
    });
  });

  it("wraps the words between two bolded words instead of unpairing the tags around them", () => {
    const text = "<b>Amazing</b> <b>grace</b>";
    expect(apply(text, toggleChartTextStyle(text, 3, 23, "b"))).toStrictEqual({
      text: "<b><b>Amazing</b> <b>grace</b></b>",
      selected: [6, 26],
    });
  });

  it("adds italic inside bold instead of removing the bold", () => {
    const text = "<b>grace</b>";
    expect(apply(text, toggleChartTextStyle(text, 3, 8, "i"))).toStrictEqual({
      text: "<b><i>grace</i></b>",
      selected: [6, 11],
    });
  });

  it("puts the caret inside an empty pair when nothing is selected", () => {
    const text = "Amazing ";
    expect(apply(text, toggleChartTextStyle(text, 8, 8, "b"))).toStrictEqual({
      text: "Amazing <b></b>",
      selected: [11, 11],
    });
  });
});
