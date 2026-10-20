import { describe, expect, it } from "vitest";

import { actionButtonStyle, supportsLiquidGlass } from "./glass-capability";

describe("glass availability and readable action styles", () => {
  it("requires both the native API and linked glass design", () => {
    expect([
      supportsLiquidGlass(false, false),
      supportsLiquidGlass(false, true),
      supportsLiquidGlass(true, false),
      supportsLiquidGlass(true, true),
    ]).toStrictEqual([false, false, false, true]);
  });

  it("keeps prominent actions filled when glass is unavailable", () => {
    expect(actionButtonStyle(false, true)).toBe("borderedProminent");
    expect(actionButtonStyle(false, false)).toBe("bordered");
    expect(actionButtonStyle(true, true)).toBe("glassProminent");
    expect(actionButtonStyle(true, false)).toBe("glass");
  });
});
