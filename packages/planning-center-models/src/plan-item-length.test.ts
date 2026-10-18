import { describe, expect, it } from "vitest";

import { buildDraft, buildRunSheet, parseLengthText } from "./plan-item-draft";
import {
  applyPlanItemDraft,
  createOptimisticBasicPlanItem,
} from "./plan-item-order";

describe("plan item length limits", () => {
  it.each([
    "86401",
    "1440:01",
    "25:00:00",
    "9999999999999999999999999999999999999999999",
  ])("bounds shared web and mobile draft duration %s", (text) => {
    expect(parseLengthText(text)).toStrictEqual({
      length: 86_400,
      error: null,
    });
  });

  it("keeps exactly 24 hours and second units", () => {
    expect(parseLengthText("24:00:00")).toStrictEqual({
      length: 86_400,
      error: null,
    });
    expect(parseLengthText("4:00")).toStrictEqual({ length: 240, error: null });
  });

  it("keeps section totals separate from header draft length", () => {
    const header = {
      ...createOptimisticBasicPlanItem("h", "header", 1),
      length: 999_999,
    };
    const child = {
      ...createOptimisticBasicPlanItem("i", "item", 2),
      length: 600,
    };
    const draft = buildDraft(header);
    expect(draft.lengthText).toBe("0:00");
    expect(buildRunSheet([header, child]).get("h")).toStrictEqual({
      sectionLength: 600,
    });
    expect(
      applyPlanItemDraft(header, draft, 999_999, null, null)
    ).toMatchObject({
      length: null,
    });
    expect(
      applyPlanItemDraft(child, buildDraft(child), 999_999, null, null)
    ).toMatchObject({ length: 86_400 });
  });
});
