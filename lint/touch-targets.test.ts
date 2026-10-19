import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { buttonVariants } from "../apps/web/src/components/ui/button-variants";

/**
 * What keeps the product usable with a finger (see docs/mobile-native-audit.md, "Touch
 * targets and sheets"): the shared primitives grow on touch screens, so call sites get
 * finger-sized controls without opting in, and anything that opens a panel opens a sheet on
 * phones.
 */
const repositoryRoot = join(import.meta.dirname, "..");
const webSource = join(repositoryRoot, "apps/web/src");
const read = (path: string): string =>
  readFileSync(join(repositoryRoot, path), "utf8");

const walkFiles = (root: string): string[] =>
  readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(path);
    }
    const test =
      entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx");
    return [".ts", ".tsx"].includes(extname(entry.name)) && !test ? [path] : [];
  });

/** Every button size; adding one to `buttonVariants` means adding it here. */
const buttonSizes = [
  "default",
  "xs",
  "sm",
  "lg",
  "icon",
  "icon-xs",
  "icon-sm",
  "icon-lg",
] as const;

const sizeKeyPattern = /^ {8}"?([\w-]+)"?:/gmu;

/** The size names declared in `buttonVariants`, read from its source. */
const declaredButtonSizes = (): string[] => {
  const source = read("apps/web/src/components/ui/button-variants.ts");
  const block = /size: \{([\s\S]*?)\n {6}\},/u.exec(source)?.[1] ?? "";
  return [...block.matchAll(sizeKeyPattern)].map((match) => match[1]);
};

const coarseSizePattern = /^pointer-coarse:(?:h|size)-(\d+)$/u;

/** The largest height or size a class string gives the element on a touch screen, in Tailwind units. */
const coarseSize = (classes: string): number =>
  Math.max(
    0,
    ...classes.split(/\s+/u).map((token) => {
      const match = coarseSizePattern.exec(token);
      return match ? Number(match[1]) : 0;
    })
  );

/** Whether the classes add a 44px tap area around the element on touch screens. */
const hasCoarseHitArea = (classes: string): boolean => {
  const tokens = classes.split(/\s+/u);
  return [
    "pointer-coarse:after:absolute",
    "pointer-coarse:after:min-h-11",
    "pointer-coarse:after:min-w-11",
  ].every((token) => tokens.includes(token));
};

describe("touch targets", () => {
  it("covers every declared button size", () => {
    expect(declaredButtonSizes()).toStrictEqual([...buttonSizes]);
  });

  it.each(buttonSizes)(
    "gives a %s button a 44px tap area on touch screens",
    (size) => {
      const classes = buttonVariants({ size });
      // 11 is 44px: drawn that size, or smaller with an invisible 44px tap area.
      expect(coarseSize(classes) >= 11 || hasCoarseHitArea(classes)).toBe(true);
      expect(coarseSize(classes)).toBeGreaterThan(0);
    }
  );

  it.each([
    ["apps/web/src/components/ui/input.tsx", "pointer-coarse:h-11"],
    ["apps/web/src/components/ui/native-select.tsx", "pointer-coarse:h-11"],
    ["apps/web/src/components/ui/input-group.tsx", "pointer-coarse:h-11"],
    [
      "apps/web/src/components/ui/tabs.tsx",
      "pointer-coarse:group-data-horizontal/tabs:h-11",
    ],
  ])("draws %s at 44px on touch screens", (path, token) => {
    expect(read(path).split(/[\s"'`]+/u)).toContain(token);
  });
});

/**
 * Files that may open the raw popover or dialog, and why it stays that way on phones.
 * Everything else uses `ResponsivePopover` or `ResponsiveDialog`, which open a bottom
 * sheet on phones: a floating panel there is cramped, lands under the keyboard, and is hard
 * to dismiss with a thumb.
 */
const rawOverlayAllowed: Record<string, string> = {
  "components/app-shell.tsx":
    "the keyboard shortcuts dialog, which only a keyboard opens",
  "components/onboarding/guided-tour.tsx":
    "coach marks point at the control they explain",
  "components/schedule/plan-file-dialog.tsx":
    'the full-screen file viewer (`variant="viewer"`)',
  "components/schedule/plan-files-browser.tsx":
    'the full-screen file viewer (`variant="viewer"`)',
  "components/sidebar-feedback.tsx":
    "the desktop sidebar's feedback form; phones use mobile-feedback-dialog",
};

const rawOverlayImportPattern =
  /from\s+["']@\/components\/ui\/(?:popover|dialog)["']/u;

describe("panels on phones", () => {
  it("opens popovers and dialogs as sheets on phones", () => {
    const rawOverlayFiles = walkFiles(webSource)
      .map((path) => relative(webSource, path))
      .filter((path) => !path.startsWith("components/ui/"))
      .filter((path) =>
        rawOverlayImportPattern.test(
          readFileSync(join(webSource, path), "utf8")
        )
      )
      .toSorted();
    expect(rawOverlayFiles).toStrictEqual(
      Object.keys(rawOverlayAllowed).toSorted()
    );
  });
});
