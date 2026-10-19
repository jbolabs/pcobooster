/**
 * The web design tokens (`packages/design-tokens/src/tokens.css`) are the source of truth for
 * every color set with a web counterpart. `syncColorSetsFromWeb` rewrites those sets' light and
 * dark entries from the CSS; high-contrast entries and native-only sets stay hand-tuned.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Schema } from "effect";

import {
  ColorEntrySchema,
  colorsDirectory,
  linearToSrgb,
  srgbOf,
  variantOf,
} from "./color-tokens.ts";
import type { SrgbColor } from "./color-tokens.ts";

export const tokensCssPath = path.join(
  import.meta.dirname,
  "../../../packages/design-tokens/src/tokens.css"
);

/**
 * A color set that is the web token of the same role, with the opacity the web applies at the
 * call site (`muted-foreground/60`, `ring-foreground/5`) per appearance.
 */
export interface WebCounterpart {
  /** The CSS variable in packages/design-tokens/src/tokens.css, without `--`. */
  readonly variable: string;
  readonly light?: number;
  readonly dark?: number;
}

export const webCounterparts: ReadonlyMap<string, WebCounterpart> = new Map(
  Object.entries({
    SurfaceCanvas: { variable: "background" },
    SurfaceCard: { variable: "card" },
    SurfaceRaised: { variable: "popover" },
    SurfaceMuted: { variable: "muted" },
    SurfaceSecondary: { variable: "secondary" },
    SurfaceHighlight: { variable: "accent" },
    SurfaceInput: { variable: "input", light: 0.5, dark: 0.5 },
    Ink: { variable: "foreground" },
    InkSecondary: { variable: "muted-foreground" },
    InkTertiary: { variable: "muted-foreground", light: 0.6, dark: 0.6 },
    InkFill: { variable: "primary" },
    OnInkFill: { variable: "primary-foreground" },
    Hairline: { variable: "border" },
    // The web ring is foreground/5 in light; the native card ring is 7% so it reads on the canvas.
    HairlineSubtle: { variable: "foreground", light: 0.07, dark: 0.1 },
    StatusConfirmed: { variable: "status-confirmed" },
    StatusPending: { variable: "status-scheduled" },
    StatusDeclined: { variable: "status-declined" },
    StatusInfo: { variable: "status-info" },
    StatusConfirmedBright: { variable: "status-confirmed-bright" },
    StatusPendingBright: { variable: "status-scheduled-bright" },
    StatusDeclinedBright: { variable: "status-declined-bright" },
    Destructive: { variable: "destructive" },
    InfoSurface: { variable: "info-surface" },
    InfoBorder: { variable: "info-border" },
    Chart1: { variable: "chart-1" },
    Chart2: { variable: "chart-2" },
    Chart3: { variable: "chart-3" },
    Chart4: { variable: "chart-4" },
    Chart5: { variable: "chart-5" },
  } satisfies Record<string, WebCounterpart>)
);

/** Color sets with no web variable: text-safe status inks and the brand greens. */
export const nativeOnly: ReadonlySet<string> = new Set([
  "BrandRocket",
  "BrandSage",
  "BrandSageSoft",
  "StatusConfirmedText",
  "StatusPendingText",
  "StatusDeclinedText",
  "StatusInfoText",
]);

/** The asset catalog stores three decimals. */
const TOLERANCE = 0.002;

const OKLCH_DECLARATION = /--(?<name>[\w-]+):\s*oklch\((?<value>[^)]+)\)/gu;

/** `--name: oklch(L C H / A)` declarations inside the block that starts with `selector {`. */
const readOklchBlock = (css: string, selector: string): Map<string, string> => {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) {
    throw new Error(`tokens.css has no ${selector} block`);
  }
  const block = css.slice(start, css.indexOf("}", start));
  return new Map(
    [...block.matchAll(OKLCH_DECLARATION)].map(({ groups }) => [
      groups?.name ?? "",
      groups?.value ?? "",
    ])
  );
};

/** The OKLCH value of every token per appearance; dark falls back to light. */
const readWebTokens = (): Record<
  "light" | "dark",
  ReadonlyMap<string, string>
> => {
  const css = readFileSync(tokensCssPath, "utf-8");
  const light = readOklchBlock(css, ":root");
  return {
    light,
    dark: new Map([...light, ...readOklchBlock(css, ".dark")]),
  };
};

const PERCENT = 100;

/** OKLCH (CSS Color 4) to gamma-encoded sRGB 0 to 1, clamped to the gamut, and its alpha. */
const oklchToSrgb = (value: string): SrgbColor => {
  const [lightness = "0", chroma = "0", hue = "0", alphaText] = value
    .replace("/", " ")
    .split(/\s+/u)
    .filter(Boolean);
  const radians = (Number(hue) * Math.PI) / 180;
  const a = Number(chroma) * Math.cos(radians);
  const b = Number(chroma) * Math.sin(radians);
  const l = Number(lightness);
  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ];
  const alpha =
    alphaText === undefined
      ? 1
      : Number(alphaText.replace("%", "")) /
        (alphaText.endsWith("%") ? PERCENT : 1);
  const [red = 0, green = 0, blue = 0] = linear.map((channel) =>
    linearToSrgb(Math.min(1, Math.max(0, channel)))
  );
  return { rgb: [red, green, blue], alpha };
};

/** The sRGB color a color set should hold for `variant`, from its web counterpart. */
const webColorFor = (
  counterpart: WebCounterpart,
  variant: "light" | "dark",
  tokens: ReturnType<typeof readWebTokens> = readWebTokens()
): SrgbColor => {
  const declared = tokens[variant].get(counterpart.variable);
  if (declared === undefined) {
    throw new Error(`tokens.css has no --${counterpart.variable}`);
  }
  const { rgb, alpha } = oklchToSrgb(declared);
  return { rgb, alpha: alpha * (counterpart[variant] ?? 1) };
};

const sameColor = (left: SrgbColor, right: SrgbColor): boolean =>
  left.rgb.every(
    (channel, index) => Math.abs(channel - (right.rgb[index] ?? 0)) < TOLERANCE
  ) && Math.abs(left.alpha - right.alpha) < TOLERANCE;

/** A whole asset catalog color set, kept intact so a rewrite only touches the colors. */
const ColorSetFileSchema = Schema.Struct({
  colors: Schema.Array(
    Schema.Struct({ ...ColorEntrySchema.fields, idiom: Schema.String })
  ),
  info: Schema.Struct({ author: Schema.String, version: Schema.Number }),
});
const ColorSetFileJson = Schema.fromJsonString(ColorSetFileSchema);
const decodeColorSetFile = Schema.decodeUnknownSync(ColorSetFileJson);

const fixed = (channel: number): string => channel.toFixed(3);

/** Xcode writes `"key" : value`; keep its format so diffs stay readable. */
const formatColorSet = (set: typeof ColorSetFileSchema.Type): string =>
  `${JSON.stringify(set, null, 2).replaceAll('": ', '" : ')}\n`;

/**
 * Rewrites the light and dark entries of every color set with a web counterpart whose value
 * drifted from tokens.css. Returns the names of the sets it changed.
 */
export const syncColorSetsFromWeb = (): string[] => {
  const tokens = readWebTokens();
  const changed: string[] = [];
  for (const [setName, counterpart] of webCounterparts) {
    const file = path.join(
      colorsDirectory,
      `${setName}.colorset`,
      "Contents.json"
    );
    const set = decodeColorSetFile(readFileSync(file, "utf-8"));
    let drifted = false;
    const colors = set.colors.map((entry) => {
      const variant = variantOf(entry);
      if (variant !== "light" && variant !== "dark") {
        return entry;
      }
      const target = webColorFor(counterpart, variant, tokens);
      if (sameColor(srgbOf(entry), target)) {
        return entry;
      }
      drifted = true;
      const [red, green, blue] = target.rgb;
      return {
        ...entry,
        color: {
          "color-space": "srgb" as const,
          components: {
            alpha: fixed(target.alpha),
            blue: fixed(blue),
            green: fixed(green),
            red: fixed(red),
          },
        },
      };
    });
    if (drifted) {
      writeFileSync(file, formatColorSet({ ...set, colors }));
      changed.push(setName);
    }
  }
  return changed;
};
