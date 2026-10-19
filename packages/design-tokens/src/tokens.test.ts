import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Contrast floors for the shared palette, measured as WCAG 2 contrast ratios. Dark mode once
 * read as muddy: secondary text, borders, and surfaces sat too close together, and call sites
 * thin them further with opacity modifiers. These floors keep any palette edit legible.
 */

const css = readFileSync(path.join(import.meta.dirname, "tokens.css"), "utf-8");

const OKLCH_DECLARATION = /--(?<name>[\w-]+):\s*oklch\((?<value>[^)]+)\)/gu;

const readBlock = (selector: string): Map<string, string> => {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf("}", start));
  return new Map(
    [...block.matchAll(OKLCH_DECLARATION)].map(({ groups }) => [
      groups?.name ?? "",
      groups?.value ?? "",
    ])
  );
};

const light = readBlock(":root");
const themes = {
  light,
  dark: new Map([...light, ...readBlock(".dark")]),
} as const;
type Theme = keyof typeof themes;

interface Color {
  /** Gamma-encoded sRGB, 0 to 1. */
  readonly rgb: readonly [number, number, number];
  readonly alpha: number;
}

const toLinear = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const toGamma = (channel: number): number =>
  channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;

const gamma = (linear: number): number =>
  toGamma(Math.min(1, Math.max(0, linear)));

/** CSS Color 4 OKLCH to sRGB, clamped to the gamut. */
const parse = (value: string): Color => {
  const [l = "0", c = "0", h = "0", alphaText] = value
    .replace("/", " ")
    .split(/\s+/u)
    .filter(Boolean);
  const hue = (Number(h) * Math.PI) / 180;
  const a = Number(c) * Math.cos(hue);
  const b = Number(c) * Math.sin(hue);
  const lightness = Number(l);
  const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  let alpha = 1;
  if (alphaText !== undefined) {
    alpha = alphaText.endsWith("%")
      ? Number(alphaText.slice(0, -1)) / 100
      : Number(alphaText);
  }
  return {
    rgb: [
      gamma(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
      gamma(
        -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short
      ),
      gamma(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short),
    ],
    alpha,
  };
};

const token = (theme: Theme, name: string): Color => {
  const value = themes[theme].get(name);
  if (value === undefined) {
    throw new Error(`${theme} has no --${name}`);
  }
  return parse(value);
};

/** `foreground` at `opacity` (a Tailwind `/NN` modifier) composited over an opaque `background`. */
const over = (
  foreground: Color,
  background: Color,
  opacity: number
): Color["rgb"] => {
  const alpha = foreground.alpha * opacity;
  const [r, g, b] = foreground.rgb.map(
    (channel, index) =>
      channel * alpha + (background.rgb[index] ?? 0) * (1 - alpha)
  );
  return [r ?? 0, g ?? 0, b ?? 0];
};

const luminance = ([r, g, b]: Color["rgb"]): number =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

const contrast = (
  theme: Theme,
  foreground: string,
  background: string,
  opacity = 1
): number => {
  const back = token(theme, background);
  const front = luminance(over(token(theme, foreground), back, opacity));
  const behind = luminance(back.rgb);
  return (Math.max(front, behind) + 0.05) / (Math.min(front, behind) + 0.05);
};

const BODY_TEXT = 7;
const SECONDARY_TEXT = 4.5;
/** `text-muted-foreground/70` marks metadata such as counts; it must stay readable. */
const FADED_TEXT = 3;
const BORDER = 1.4;
/** `border-border/40` dividers inside cards. */
const FADED_BORDER = 1.12;
/** A raised dark surface must read as a separate plane from the one it sits on. */
const SURFACE_STEP = 1.08;

describe.each(["light", "dark"] as const)("%s tokens", (theme) => {
  it.each(["background", "card", "popover"])(
    "keeps body text readable on %s",
    (surface) => {
      expect(contrast(theme, "foreground", surface)).toBeGreaterThanOrEqual(
        BODY_TEXT
      );
    }
  );

  it.each(["background", "card", "popover", "muted", "secondary", "accent"])(
    "keeps secondary text readable on %s",
    (surface) => {
      expect(
        contrast(theme, "muted-foreground", surface)
      ).toBeGreaterThanOrEqual(SECONDARY_TEXT);
    }
  );

  it("keeps faded secondary text readable on cards", () => {
    expect(
      contrast(theme, "muted-foreground", "card", 0.7)
    ).toBeGreaterThanOrEqual(FADED_TEXT);
  });

  it("keeps primary buttons readable", () => {
    expect(
      contrast(theme, "primary-foreground", "primary")
    ).toBeGreaterThanOrEqual(BODY_TEXT);
  });

  it.each(["card", "background"])("keeps borders visible on %s", (surface) => {
    expect(contrast(theme, "border", surface)).toBeGreaterThanOrEqual(BORDER);
    expect(contrast(theme, "input", surface)).toBeGreaterThanOrEqual(BORDER);
  });

  it("keeps thinned dividers visible on cards", () => {
    expect(contrast(theme, "border", "card", 0.4)).toBeGreaterThanOrEqual(
      FADED_BORDER
    );
  });
});

describe("dark tokens", () => {
  // Light mode pairs the amber and blue statuses with fills; dark mode sets them as text.
  it.each([
    "destructive",
    "status-confirmed",
    "status-scheduled",
    "status-declined",
    "status-info",
  ])("keeps %s readable as text on cards", (status) => {
    expect(contrast("dark", status, "card")).toBeGreaterThanOrEqual(
      SECONDARY_TEXT
    );
  });

  it.each([
    ["background", "sidebar"],
    ["card", "background"],
    ["popover", "card"],
    ["muted", "card"],
  ])("lifts %s off %s", (upper, lower) => {
    expect(contrast("dark", upper, lower)).toBeGreaterThanOrEqual(SURFACE_STEP);
  });
});
