import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  generatedPath,
  linearToSrgb,
  readColorTokens,
  renderColorTokens,
  srgbOf,
} from "../../scripts/color-tokens.ts";
import type { SrgbColor, Variant } from "../../scripts/color-tokens.ts";
import {
  nativeOnly,
  tokensCssPath,
  webCounterparts,
} from "../../scripts/web-color-tokens.ts";

/** `--name: oklch(L C H / A)` declarations inside the block that starts with `selector {`. */
const readOklchBlock = (css: string, selector: string): Map<string, string> => {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf("}", start));
  return new Map(
    [...block.matchAll(/--(?<name>[\w-]+):\s*oklch\((?<value>[^)]+)\)/gu)].map(
      ({ groups }) => [groups?.name ?? "", groups?.value ?? ""]
    )
  );
};

/** OKLCH (CSS Color 4) to gamma-encoded sRGB 0 to 1, unclamped, and its alpha. */
const oklchToSrgb = (value: string): SrgbColor => {
  const [lightness = "0", chroma = "0", hue = "0", alphaText] = value
    .replace("/", " ")
    .split(/\s+/u)
    .filter(Boolean);
  const radians = (Number(hue) * Math.PI) / 180;
  const a = Number(chroma) * Math.cos(radians);
  const b = Number(chroma) * Math.sin(radians);
  const l = Number(lightness);
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ] as const;
  const [long, medium, short] = lms;
  const linear = [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ];
  const alpha =
    alphaText === undefined
      ? 1
      : Number(alphaText.replace("%", "")) /
        (alphaText.endsWith("%") ? 100 : 1);
  const [red = 0, green = 0, blue = 0] = linear.map((channel) =>
    linearToSrgb(Math.min(1, Math.max(0, channel)))
  );
  return { rgb: [red, green, blue], alpha };
};

/** The asset catalog stores three decimals. */
const TOLERANCE = 0.002;

describe("color tokens", () => {
  it("keeps colors.generated.ts in step with assets/colors", () => {
    expect(readFileSync(generatedPath, "utf-8")).toBe(renderColorTokens());
  });

  it("names every color set as a web counterpart or a native-only token", () => {
    const unlisted = readColorTokens()
      .map(({ setName }) => setName)
      .filter((name) => !webCounterparts.has(name) && !nativeOnly.has(name));
    expect(unlisted).toStrictEqual([]);
  });

  const css = readFileSync(tokensCssPath, "utf-8");
  const light = readOklchBlock(css, ":root");
  const dark = new Map([...light, ...readOklchBlock(css, ".dark")]);
  const cases = readColorTokens().flatMap(({ setName, variants }) => {
    const counterpart = webCounterparts.get(setName);
    if (counterpart === undefined) {
      return [];
    }
    return (["light", "dark"] as const satisfies readonly Variant[]).flatMap(
      (variant) => {
        const entry = variants[variant];
        return entry === undefined
          ? []
          : [{ setName, variant, entry, counterpart }];
      }
    );
  });

  it.each(cases)(
    "$setName $variant equals the web token (bun run tokens syncs it)",
    ({ variant, entry, counterpart }) => {
      const declared = (variant === "dark" ? dark : light).get(
        counterpart.variable
      );
      expect(declared).toBeDefined();
      const web = oklchToSrgb(declared ?? "");
      const native = srgbOf(entry);
      const opacity = counterpart[variant] ?? 1;
      for (const [index, channel] of native.rgb.entries()) {
        expect(Math.abs(channel - (web.rgb[index] ?? 0))).toBeLessThan(
          TOLERANCE
        );
      }
      expect(Math.abs(native.alpha - web.alpha * opacity)).toBeLessThan(
        TOLERANCE
      );
    }
  );
});
