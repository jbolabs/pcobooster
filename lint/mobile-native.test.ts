import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { siteHead } from "../apps/marketing/src/lib/site-head";
import { productHeadMeta } from "../apps/web/src/lib/document-head";
import { parseJsxElements, stringLiterals } from "./jsx-elements";
import type { JsxElement } from "./jsx-elements";

/**
 * The platform layer that decides whether the product and marketing site feel native on a
 * phone (see docs/mobile-native-audit.md). Class strings are covered by the local oxlint
 * rules `no-small-field-text`, `scroll-container-overscroll`, and `field-keyboard-hints`;
 * this covers stylesheets, compiled Tailwind, document metadata, and touch scripting.
 */
const repositoryRoot = join(import.meta.dirname, "..");
const checkedRoots = [
  "apps/web/src",
  "apps/marketing/src",
  "packages/ui/src",
  "packages/design-tokens/src",
];
const checkedExtensions = new Set([".css", ".ts", ".tsx"]);

const walkFiles = (root: string): string[] =>
  readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : walkFiles(path);
    }
    const generated =
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".test.tsx") ||
      entry.name === "routeTree.gen.ts";
    return checkedExtensions.has(extname(entry.name)) && !generated
      ? [path]
      : [];
  });

const sourceFiles = checkedRoots
  .flatMap((root) => walkFiles(join(repositoryRoot, root)))
  .map((path) => ({
    path: relative(repositoryRoot, path),
    contents: readFileSync(path, "utf8"),
  }));
const stylesheets = sourceFiles.filter(({ path }) => path.endsWith(".css"));
const scripts = sourceFiles.filter(({ path }) => !path.endsWith(".css"));

const lineOf = (contents: string, index: number): number =>
  contents.slice(0, index).split("\n").length;

interface CssRule {
  /** Enclosing preludes, outermost first: at-rules and selectors. */
  ancestors: string[];
  prelude: string;
  declarations: string[];
  line: number;
}

const commentPattern = /\/\*[\s\S]*?\*\//gu;

/** Every block in a stylesheet with its preludes and own declarations; enough for these checks. */
const parseCss = (source: string): CssRule[] => {
  // Blank comments out without moving any character, so line numbers stay true.
  const css = source.replaceAll(commentPattern, (comment) =>
    comment.replaceAll(/[^\n]/gu, " ")
  );
  const rules: CssRule[] = [];
  const stack: CssRule[] = [];
  let start = 0;
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (character === "{") {
      const prelude = css.slice(start, index).trim();
      const rule: CssRule = {
        ancestors: stack.map((parent) => parent.prelude),
        prelude,
        declarations: [],
        line: lineOf(css, start + css.slice(start, index).search(/\S/u)),
      };
      rules.push(rule);
      stack.push(rule);
      start = index + 1;
    } else if (character === ";" || character === "}") {
      const declaration = css.slice(start, index).trim();
      if (declaration !== "") {
        stack.at(-1)?.declarations.push(declaration);
      }
      if (character === "}") {
        stack.pop();
      }
      start = index + 1;
    }
  }
  return rules;
};

const hoverMediaPattern =
  /@media[^{]*\(\s*hover\s*:\s*hover\s*\)[^{]*\(\s*pointer\s*:\s*fine\s*\)/u;
const finePointerMediaPattern = /@media[^{]*\(\s*pointer\s*:\s*fine\s*\)/u;

const isHoverGated = (rule: CssRule): boolean =>
  rule.ancestors.some((ancestor) => hoverMediaPattern.test(ancestor)) ||
  hoverMediaPattern.test(rule.prelude);

/** A `:hover` pseudo-class, not an escaped `\\:hover` inside a compiled class name. */
const hoverPseudoClass = /(?<!\\):hover\b/u;

/** `:hover` selectors outside `@media (hover: hover) and (pointer: fine)`. */
const ungatedHoverRules = (css: string): CssRule[] =>
  parseCss(css).filter(
    (rule) =>
      !rule.prelude.startsWith("@") &&
      hoverPseudoClass.test(rule.prelude) &&
      !isHoverGated(rule)
  );

const fieldElementPattern = /(?:^|[\s>+~(,])(?:input|textarea|select)\b/u;
const fontSizePattern = /^font-size\s*:\s*([\d.]+)(px|rem)\b/u;
const MIN_FIELD_FONT_PX = 16;
const REM_PX = 16;

/** Field rules with text under 16px that touch screens would get. */
const smallFieldFontRules = (
  css: string,
  fieldClasses: ReadonlySet<string>
): CssRule[] =>
  parseCss(css).filter((rule) => {
    const selectors = [...rule.ancestors, rule.prelude].filter(
      (prelude) => !prelude.startsWith("@")
    );
    const targetsField = selectors.some(
      (selector) =>
        fieldElementPattern.test(selector) ||
        [...fieldClasses].some((name) => selectsClass(selector, name))
    );
    const small = rule.declarations.some((declaration) => {
      const match = fontSizePattern.exec(declaration);
      if (match === null) {
        return false;
      }
      const size = Number(match[1]) * (match[2] === "rem" ? REM_PX : 1);
      return size < MIN_FIELD_FONT_PX;
    });
    const fineOnly = rule.ancestors.some((ancestor) =>
      finePointerMediaPattern.test(ancestor)
    );
    return targetsField && small && !fineOnly;
  });

const scrollOverflowPattern =
  /^overflow(-[xy])?\s*:\s*[^;]*\b(?:auto|scroll)\b/u;
const overscrollPattern = /^overscroll-behavior(-[xy])?\s*:/u;

/** Scroll containers that don't say what happens at their edge. */
const unboundedScrollRules = (css: string): CssRule[] =>
  parseCss(css).filter(
    (rule) =>
      rule.declarations.some((declaration) =>
        scrollOverflowPattern.test(declaration)
      ) &&
      !rule.declarations.some((declaration) =>
        overscrollPattern.test(declaration)
      )
  );

/** CSS module classes the TSX beside a stylesheet puts on text fields. */
const fieldClassPattern =
  /<(?:input|textarea|select)\b[^>]*?className=\{styles(?:\[\s*["']([\w-]+)["']\s*\]|\.(\w+))\}/gu;
const untypedInputPattern =
  /type=["'](?:checkbox|radio|hidden|range|file|color)["']/u;

const fieldClassesNear = (cssPath: string): Set<string> =>
  new Set(
    scripts
      .filter(({ path }) => dirname(path) === dirname(cssPath))
      .flatMap(({ contents }) =>
        [...contents.matchAll(fieldClassPattern)]
          .filter(([tag]) => !untypedInputPattern.test(tag))
          .map((match) => match[1] ?? match[2] ?? "")
      )
  );

const selectsClass = (selector: string, name: string): boolean =>
  new RegExp(`\\.${name}(?![\\w-])`, "u").test(selector);

const violations = <T>(
  files: { path: string; contents: string }[],
  find: (file: { path: string; contents: string }) => T[],
  describeViolation: (path: string, found: T) => string
): string[] =>
  files.flatMap((file) =>
    find(file).map((found) => describeViolation(file.path, found))
  );

const largeViewportPattern =
  /(?<![\w-])(?:(?:min-|max-)?h-screen)(?![\w-])|(?<![\w.])\d+(?:\.\d+)?vh\b/gu;
const zoomLockPattern = /user-scalable|maximum-scale/gu;
const deviceSniffingPattern =
  /navigator\s*\.\s*(?:userAgent|userAgentData|platform|maxTouchPoints)|\bontouchstart\b/gu;
/** `(hover: hover)` that doesn't also require a fine pointer, in a class string or matchMedia. */
const coarseHoverQueryPattern =
  /\(\s*hover\s*:\s*hover\s*\)(?![^"'`\]]*pointer\s*:\s*fine)/gu;
const scrollListenerPattern =
  /addEventListener\(\s*["'](?:touchstart|touchmove|wheel)["'][^;]*/gu;

const matchLines = (contents: string, pattern: RegExp): number[] =>
  [...contents.matchAll(pattern)].map((match) => lineOf(contents, match.index));

describe("mobile-native stylesheet checks", () => {
  it("finds hover styles outside a hover and fine-pointer query", () => {
    expect(
      ungatedHoverRules(
        [
          ".row:hover { color: red; }",
          "@media (hover: hover) { .tab:hover { color: red; } }",
          "@media (hover: hover) and (pointer: fine) {",
          "  .menu:hover { color: red; }",
          "}",
          ".list { & > li:hover { color: red; } }",
        ].join("\n")
      ).map(({ prelude, line }) => `${line}: ${prelude}`)
    ).toStrictEqual(["1: .row:hover", "2: .tab:hover", "6: & > li:hover"]);
  });

  it("finds field text under 16px that touch screens get", () => {
    expect(
      smallFieldFontRules(
        [
          ".search input { font-size: 13px; }",
          ".picker select { font-size: 16px; }",
          ".chart { font-size: 0.8rem; }",
          "@media (pointer: fine) { .search input { font-size: 13px; } }",
          ".label { font-size: 12px; }",
        ].join("\n"),
        new Set(["chart"])
      ).map(({ line }) => line)
    ).toStrictEqual([1, 3]);
  });

  it("finds scroll containers without an overscroll choice", () => {
    expect(
      unboundedScrollRules(
        [
          ".list { overflow-y: auto; }",
          ".strip { overflow-x: auto; overscroll-behavior-x: contain; }",
          ".clip { overflow: hidden; }",
        ].join("\n")
      ).map(({ prelude }) => prelude)
    ).toStrictEqual([".list"]);
  });
});

describe("mobile-native platform layer", () => {
  it("keeps every stylesheet hover style off touch screens", () => {
    expect(
      violations(
        stylesheets,
        ({ contents }) => ungatedHoverRules(contents),
        (path, rule) =>
          `${path} line ${rule.line}: \`${rule.prelude}\` sticks after a tap; wrap it in @media (hover: hover) and (pointer: fine)`
      )
    ).toStrictEqual([]);
  });

  it("keeps stylesheet fields at 16px on touch screens", () => {
    expect(
      violations(
        stylesheets,
        ({ path, contents }) =>
          smallFieldFontRules(contents, fieldClassesNear(path)),
        (path, rule) =>
          `${path} line ${rule.line}: \`${rule.prelude}\` sets field text under 16px, so iOS zooms on focus; move it into @media (pointer: fine)`
      )
    ).toStrictEqual([]);
  });

  it("gives every stylesheet scroll container an overscroll choice", () => {
    expect(
      violations(
        stylesheets,
        ({ contents }) => unboundedScrollRules(contents),
        (path, rule) =>
          `${path} line ${rule.line}: \`${rule.prelude}\` scrolls without overscroll-behavior; use contain for panels and sideways strips, or auto where chaining to the page is intended`
      )
    ).toStrictEqual([]);
  });

  it("sizes full-height layouts with dvh or svh, never vh", () => {
    expect(
      violations(
        sourceFiles,
        ({ contents }) => matchLines(contents, largeViewportPattern),
        (path, line) =>
          `${path} line ${line}: vh and h-screen are the largest viewport and overflow under the browser bars; use dvh for app chrome or svh for heroes`
      )
    ).toStrictEqual([]);
  });

  it("never locks pinch zoom", () => {
    expect(
      violations(
        sourceFiles,
        ({ contents }) => matchLines(contents, zoomLockPattern),
        (path, line) =>
          `${path} line ${line}: user-scalable and maximum-scale disable zoom; fix the field size that caused the zoom instead`
      )
    ).toStrictEqual([]);
  });

  it("detects touch by capability, not by device", () => {
    expect(
      violations(
        scripts,
        ({ contents }) => matchLines(contents, deviceSniffingPattern),
        (path, line) =>
          `${path} line ${line}: use (hover) and (pointer) media queries instead of sniffing the device`
      )
    ).toStrictEqual([]);
  });

  it("asks for a fine pointer wherever scripts and classes ask for hover", () => {
    expect(
      violations(
        scripts,
        ({ contents }) => matchLines(contents, coarseHoverQueryPattern),
        (path, line) =>
          `${path} line ${line}: some touch devices report (hover: hover); use the can-hover: variant or (hover: hover) and (pointer: fine)`
      )
    ).toStrictEqual([]);
  });

  it("keeps touch and wheel listeners passive", () => {
    expect(
      violations(
        scripts,
        ({ contents }) =>
          [...contents.matchAll(scrollListenerPattern)]
            .filter(([call]) => !/passive:\s*true/u.test(call))
            .map((match) => lineOf(contents, match.index)),
        (path, line) =>
          `${path} line ${line}: a non-passive touch or wheel listener can block scrolling; pass { passive: true } and use overscroll-behavior to stop scroll chaining`
      )
    ).toStrictEqual([]);
  });
});

/** Resolves stylesheet imports the way each app's Vite build does. */
const stylesheetLoader = (appDirectory: string) => {
  const requireFromApp = createRequire(join(appDirectory, "package.json"));
  const resolveStylesheet = (id: string, base: string): string => {
    if (id.startsWith(".")) {
      return join(base, id);
    }
    try {
      return requireFromApp.resolve(
        id === "tailwindcss" ? "tailwindcss/index.css" : id
      );
    } catch {
      // Packages that export their stylesheet only under the `style` condition.
      const packageDirectory = join(appDirectory, "node_modules", id);
      const manifest: {
        style?: string;
        exports?: { "."?: { style?: string } };
      } = JSON.parse(
        readFileSync(join(packageDirectory, "package.json"), "utf8")
      );
      return join(
        packageDirectory,
        manifest.exports?.["."]?.style ?? manifest.style ?? "index.css"
      );
    }
  };
  return async (id: string, base: string) => {
    const path = resolveStylesheet(id, base);
    return { path, base: dirname(path), content: readFileSync(path, "utf8") };
  };
};

/** The part of Tailwind's `compile` API these checks use. */
interface TailwindCompiler {
  compile: (
    css: string,
    options: {
      base: string;
      loadStylesheet: ReturnType<typeof stylesheetLoader>;
    }
  ) => Promise<{ build: (candidates: string[]) => string }>;
}

/** Class tokens that mention hover, as written in an app's source and the shared UI. */
const hoverCandidates = (roots: string[]): string[] => [
  ...new Set(
    sourceFiles
      .filter(({ path }) => roots.some((root) => path.startsWith(root)))
      .flatMap(({ contents }) => contents.split(/[\s"'`{}]+/u))
      .filter((token) => token.includes("hover") && token.length < 200)
  ),
];

describe.each([
  ["apps/web", "src/styles/globals.css"],
  ["apps/marketing", "src/styles/globals.css"],
])("%s compiled Tailwind", (app, stylesheetPath) => {
  it("puts every hover utility behind a hover and fine-pointer query", async () => {
    const appDirectory = join(repositoryRoot, app);
    // Each app's own Tailwind; the repository root doesn't depend on it.
    const { compile }: TailwindCompiler = createRequire(
      join(appDirectory, "package.json")
    )("tailwindcss");
    const stylesheet = join(appDirectory, stylesheetPath);
    const compiler = await compile(readFileSync(stylesheet, "utf8"), {
      base: dirname(stylesheet),
      loadStylesheet: stylesheetLoader(appDirectory),
    });
    const css = compiler.build(
      hoverCandidates([`${app}/src`, "packages/ui/src"])
    );
    expect(css).toContain(":hover");
    expect(ungatedHoverRules(css).map(({ prelude }) => prelude)).toStrictEqual(
      []
    );
  });
});

/** The parts of a viewport meta, so their order doesn't matter. */
const viewportParts = (content: string | undefined): string[] =>
  (content ?? "")
    .split(",")
    .map((part) => part.trim().replaceAll(/\s+/gu, ""))
    .toSorted();

const metaContent = (
  meta: readonly object[],
  name: string
): string | undefined => {
  for (const entry of meta) {
    if ("name" in entry && entry.name === name && "content" in entry) {
      return String(entry.content);
    }
  }
  return undefined;
};

/** A theme-color meta in a head helper, JSX, or a selector; prose may still name it. */
const themeColorMetaPattern =
  /name(?:\s*[:=]\s*\{?|=)\s*["']theme-color["']|\[name=["']?theme-color/u;

describe("document metadata", () => {
  it.each([
    ["product", productHeadMeta()],
    ["marketing", siteHead().meta],
  ])(
    "lets the %s draw edge to edge and resize for the keyboard",
    (_site, meta) => {
      expect(viewportParts(metaContent(meta, "viewport"))).toStrictEqual([
        "initial-scale=1",
        "interactive-widget=resizes-content",
        "viewport-fit=cover",
        "width=device-width",
      ]);
    }
  );

  /*
   * Both apps open the shared full-screen phone menu. While it was a frosted fixed layer,
   * Safari 26 filled its bar areas with a solid color; with theme-color metas on the product,
   * a line then stayed above Safari's bottom bar after the menu closed, on every page until a
   * reload. Without them (#175), Safari tints its bars from the page.
   */
  it.each([
    ["product", productHeadMeta(), ["charSet", "viewport", "color-scheme"]],
    ["marketing", siteHead().meta, ["charSet", "viewport", "color-scheme"]],
  ])(
    "leaves the %s's browser bars to the page, with no theme-color",
    (_site, meta, expected) => {
      expect(
        meta.map((entry) => ("name" in entry ? entry.name : "charSet"))
      ).toStrictEqual(expected);
    }
  );

  it("renders, queries, or writes no theme-color meta anywhere in either app", () => {
    const writers = scripts
      .filter(({ contents }) => themeColorMetaPattern.test(contents))
      .map(({ path }) => path);
    expect(scripts.map(({ path }) => path)).toContain(
      "apps/web/src/routes/__root.tsx"
    );
    expect(writers).toStrictEqual([]);
  });

  it("gives the installed app its header color, not the brand color", () => {
    const manifest: { theme_color?: string; background_color?: string } =
      JSON.parse(
        readFileSync(
          join(repositoryRoot, "apps/web/public/manifest.webmanifest"),
          "utf8"
        )
      );
    expect([manifest.theme_color, manifest.background_color]).toStrictEqual([
      "#eff2ee",
      "#eff2ee",
    ]);
  });

  it("keeps the marketing site light-only", () => {
    expect(metaContent(siteHead().meta, "color-scheme")).toBe("light");
  });
});

/** Every JSX element in a TSX file, with the elements around it. */
const jsxElements = (path: string): JsxElement[] =>
  parseJsxElements(path, readFileSync(join(repositoryRoot, path), "utf8"));

/** A class token without its variants: `md:hidden` is `hidden`, `[&>a]:hover:x` is `x`. */
const utilityOf = (token: string): string => {
  let depth = 0;
  let start = 0;
  for (const [index, character] of [...token].entries()) {
    if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
    } else if (character === ":" && depth === 0) {
      start = index + 1;
    }
  }
  return token.slice(start);
};

const isViewportConstrained = (element: JsxElement): boolean =>
  element.classes.some((token) =>
    ["fixed", "sticky"].includes(utilityOf(token))
  );

const backdropClasses = (elements: JsxElement[]): string[] =>
  elements.flatMap(({ classes }) =>
    classes.filter((token) => utilityOf(token).startsWith("backdrop-"))
  );

const lvhHeightPattern = /^h-\[(\d+)lvh\]$/u;

/*
 * Safari 26 decides how to draw its toolbar edges from what the page shows there
 * (WebKit `LocalFrameView::fixedContainerEdges`): it hit-tests 4px inside each viewport edge
 * the browser UI covers and walks up from the hit element to the first fixed or sticky
 * ancestor of about the viewport's size (90% to 105% across the edge and along it). A
 * backdrop filter anywhere on that walk makes the edge "multiple colors": Safari then fills
 * the area under its bar with a solid color and drops the soft glass, which reads as a hard
 * line above the bar while the menu is open. A layer taller than 105% of the viewport is
 * skipped, and with no fixed or sticky ancestor left the bars stay glass over the page.
 * See docs/mobile-native-audit.md, finding 27.
 */
describe("the phone menu under Safari's toolbars", () => {
  const sharedMenu = jsxElements("packages/ui/src/mobile-menu.tsx");
  const [overlay] = sharedMenu.filter(
    ({ attributes }) =>
      stringLiterals(attributes.get("data-slot")).join() ===
      "mobile-menu-overlay"
  );
  const insideOverlay = sharedMenu.filter(({ ancestors }) =>
    ancestors.includes(overlay)
  );

  it("draws the menu on an opaque page-colored layer with no backdrop filter", () => {
    expect(
      overlay.classes.filter((token) => utilityOf(token).startsWith("bg-"))
    ).toStrictEqual(["bg-background"]);
    expect(backdropClasses([overlay, ...insideOverlay])).toStrictEqual([]);
  });

  it("makes the fixed layer taller than Safari's 105% viewport-size cutoff", () => {
    const heights = overlay.classes.flatMap((token) => {
      const match = lvhHeightPattern.exec(token);
      return match ? [Number(match[1])] : [];
    });
    expect(overlay.classes).toContain("fixed");
    expect(heights).toHaveLength(1);
    expect(heights[0]).toBeGreaterThan(105);
  });

  it("keeps the menu's own content off fixed and sticky positioning", () => {
    expect(insideOverlay.map(({ tag }) => tag)).toContain("div");
    expect(
      insideOverlay.filter(isViewportConstrained).map(({ classes }) => classes)
    ).toStrictEqual([]);
  });

  it.each([
    ["apps/web/src/components/mobile-menu.tsx"],
    ["apps/marketing/src/components/site.tsx"],
  ])(
    "renders %s's menu outside sticky and fixed elements, without a frost",
    (path) => {
      const menus = jsxElements(path).filter(
        ({ tag }) => tag === "MobileMenuOverlay"
      );
      expect(menus).toHaveLength(1);
      const [menu] = menus;
      expect(
        menu.ancestors
          .filter(isViewportConstrained)
          .map(
            ({ tag, classes }) => `<${tag} className="${classes.join(" ")}">`
          )
      ).toStrictEqual([]);
      expect(
        menu.classes.filter((token) =>
          /^(?:bg-|backdrop-)/u.test(utilityOf(token))
        )
      ).toStrictEqual([]);
    }
  );
});
