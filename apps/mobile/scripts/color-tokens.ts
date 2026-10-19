/**
 * Reads the color tokens (`assets/colors/<Name>.colorset/Contents.json`, the asset catalog
 * format the SwiftUI app shipped) and renders `src/design/colors.generated.ts`.
 *
 * React Native colors are sRGB only, so Display P3 entries are converted to sRGB and clamped
 * to its gamut. Run `bun run tokens` after changing a color set.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { Schema } from "effect";

export const colorsDirectory = path.join(
  import.meta.dirname,
  "../assets/colors"
);
export const generatedPath = path.join(
  import.meta.dirname,
  "../src/design/colors.generated.ts"
);

export type Rgb = readonly [number, number, number];
/** sRGB channels 0 to 255 and alpha 0 to 1. */
export type Rgba = readonly [number, number, number, number];
export type Variant =
  | "light"
  | "dark"
  | "highContrastLight"
  | "highContrastDark";

export const ColorEntrySchema = Schema.Struct({
  appearances: Schema.optional(
    Schema.Array(
      Schema.Struct({ appearance: Schema.String, value: Schema.String })
    )
  ),
  color: Schema.Struct({
    "color-space": Schema.Literals(["srgb", "display-p3"]),
    components: Schema.Struct({
      alpha: Schema.String,
      blue: Schema.String,
      green: Schema.String,
      red: Schema.String,
    }),
  }),
});
type ColorEntry = typeof ColorEntrySchema.Type;

/** An asset catalog color set (`Contents.json`). */
const decodeColorSet = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ colors: Schema.Array(ColorEntrySchema) })
  )
);

const SRGB_LINEAR_KNEE = 0.04045;
const SRGB_LINEAR_SLOPE = 12.92;
const SRGB_GAMMA_KNEE = 0.0031308;
const SRGB_GAMMA = 2.4;
const SRGB_OFFSET = 0.055;
const CHANNEL_MAX = 255;

export const srgbToLinear = (channel: number): number =>
  channel <= SRGB_LINEAR_KNEE
    ? channel / SRGB_LINEAR_SLOPE
    : ((channel + SRGB_OFFSET) / (1 + SRGB_OFFSET)) ** SRGB_GAMMA;

export const linearToSrgb = (channel: number): number =>
  channel <= SRGB_GAMMA_KNEE
    ? channel * SRGB_LINEAR_SLOPE
    : (1 + SRGB_OFFSET) * channel ** (1 / SRGB_GAMMA) - SRGB_OFFSET;

const clampUnit = (channel: number): number =>
  Math.min(1, Math.max(0, channel));

/** Linear channels to gamma-encoded sRGB, clamped to the sRGB gamut. */
export const encodeLinearSrgb = ([red, green, blue]: Rgb): Rgb => [
  linearToSrgb(clampUnit(red)),
  linearToSrgb(clampUnit(green)),
  linearToSrgb(clampUnit(blue)),
];

/** Gamma-encoded Display P3 to gamma-encoded sRGB, clamped to the sRGB gamut (both D65). */
export const displayP3ToSrgb = ([red, green, blue]: Rgb): Rgb => {
  const lr = srgbToLinear(red);
  const lg = srgbToLinear(green);
  const lb = srgbToLinear(blue);
  return encodeLinearSrgb([
    1.2249401 * lr - 0.2249404 * lg,
    -0.0420569 * lr + 1.0420571 * lg,
    -0.0196376 * lr - 0.0786361 * lg + 1.0982735 * lb,
  ]);
};

export const variantOf = (entry: ColorEntry): Variant => {
  const dark =
    entry.appearances?.some(
      ({ appearance, value }) => appearance === "luminosity" && value === "dark"
    ) ?? false;
  const highContrast =
    entry.appearances?.some(
      ({ appearance, value }) => appearance === "contrast" && value === "high"
    ) ?? false;
  if (highContrast) {
    return dark ? "highContrastDark" : "highContrastLight";
  }
  return dark ? "dark" : "light";
};

/** Gamma-encoded sRGB channels 0 to 1, and alpha. */
export interface SrgbColor {
  readonly rgb: Rgb;
  readonly alpha: number;
}

/** The entry's color as gamma-encoded sRGB. */
export const srgbOf = (entry: ColorEntry): SrgbColor => {
  const { components } = entry.color;
  const raw: Rgb = [
    Number(components.red),
    Number(components.green),
    Number(components.blue),
  ];
  const rgb =
    entry.color["color-space"] === "srgb" ? raw : displayP3ToSrgb(raw);
  return { rgb, alpha: Number(components.alpha) };
};

const toRgba = ({ rgb, alpha }: SrgbColor): Rgba => [
  Math.round(rgb[0] * CHANNEL_MAX),
  Math.round(rgb[1] * CHANNEL_MAX),
  Math.round(rgb[2] * CHANNEL_MAX),
  alpha,
];

export interface ColorToken {
  /** The color set name, such as `SurfaceCanvas`. */
  readonly setName: string;
  readonly variants: Readonly<Partial<Record<Variant, ColorEntry>>>;
}

/** Every color set, sorted by name, with its entries by variant. */
export const readColorTokens = (): ColorToken[] =>
  readdirSync(colorsDirectory)
    .filter((name) => name.endsWith(".colorset"))
    .toSorted()
    .map((directory) => {
      const set = decodeColorSet(
        readFileSync(
          path.join(colorsDirectory, directory, "Contents.json"),
          "utf-8"
        )
      );
      const variants: Partial<Record<Variant, ColorEntry>> = {};
      for (const entry of set.colors) {
        variants[variantOf(entry)] = entry;
      }
      if (variants.light === undefined) {
        throw new Error(`${directory} has no light color`);
      }
      return { setName: directory.replace(".colorset", ""), variants };
    });

const variantOrder: readonly Variant[] = [
  "light",
  "dark",
  "highContrastLight",
  "highContrastDark",
];

const lowerFirst = (name: string): string =>
  name.charAt(0).toLowerCase() + name.slice(1);

/** The source of `src/design/colors.generated.ts`. */
export const renderColorTokens = (): string => {
  const tokens = readColorTokens();
  const lines = tokens.map(({ setName, variants }) => {
    const body = variantOrder
      .flatMap((variant) => {
        const entry = variants[variant];
        return entry === undefined
          ? []
          : [`${variant}: [${toRgba(srgbOf(entry)).join(", ")}]`];
      })
      .join(", ");
    return `  ${lowerFirst(setName)}: { ${body} },`;
  });
  const converted = tokens.flatMap(({ setName, variants }) =>
    Object.values(variants).some(
      (entry) => entry.color["color-space"] === "display-p3"
    )
      ? [setName]
      : []
  );
  const mapperLines = tokens.map(
    ({ setName }) => `  ${lowerFirst(setName)}: make("${lowerFirst(setName)}"),`
  );
  return `// Generated by scripts/generate-tokens.ts from assets/colors. Do not edit by hand.
// Values are sRGB [red, green, blue, alpha]. Display P3 tokens converted to sRGB:
// ${converted.join(", ")}.

export type Rgba = readonly [number, number, number, number];

export interface ColorTokenValue {
  readonly light: Rgba;
  readonly dark?: Rgba;
  readonly highContrastLight?: Rgba;
  readonly highContrastDark?: Rgba;
}

export const colorTokens = {
${lines.join("\n")}
} as const satisfies Record<string, ColorTokenValue>;

export type ColorTokenName = keyof typeof colorTokens;

/** One value per token, such as a dynamic color for each. */
export const mapColorTokens = <Value>(
  make: (name: ColorTokenName) => Value
): Record<ColorTokenName, Value> => ({
${mapperLines.join("\n")}
});
`;
};
