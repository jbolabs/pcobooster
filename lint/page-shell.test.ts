import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..");
const productSource = "apps/web/src";

/** The shell every page in the sidebar inset renders through (`PageShell`, `PageScrollArea`). */
const pageShellPath = "apps/web/src/components/page-shell.tsx";
/** Sets `--page-gutter` for the inset. */
const appShellPath = "apps/web/src/components/app-shell.tsx";
const sharedUiDirectory = "apps/web/src/components/ui/";

/** Pages that render outside the sidebar inset, and so outside `PageShell`. */
const outsideInset = new Map([
  [
    "apps/web/src/components/auth/auth-sign-in-card.tsx",
    "the signed-out sign-in screen",
  ],
  [
    "apps/web/src/components/demo/demo-entry.tsx",
    "the demo entry screen before sign-in",
  ],
]);

/** Vertical scrollers that are not the page: overlays and boxed panels scroll inside themselves. */
const panelScrollers = new Map([
  [
    "apps/web/src/components/schedule/plan-files-browser.tsx",
    "the plan file dialog list",
  ],
  [
    "apps/web/src/components/schedule/plan-file-viewer.tsx",
    "the file dialog image viewer",
  ],
  [
    "apps/web/src/components/schedule/file-pdf-reader.tsx",
    "the file dialog PDF reader",
  ],
  ["apps/web/src/components/mobile-menu.tsx", "the phone menu overlay"],
  [
    "apps/web/src/components/schedule/add-song-palette.tsx",
    "the song dialog's preview column",
  ],
  [
    "apps/web/src/components/schedule/key-transition-popover.tsx",
    "the key change popover, capped to the room beside its trigger",
  ],
  [
    "apps/web/src/components/schedule/plan-item-pane.tsx",
    "the plan builder's details pane",
  ],
  [
    "apps/web/src/components/schedule/plan-person-edit-dialog.tsx",
    "a dialog body",
  ],
  [
    "apps/web/src/components/schedule/plan-time-create-dialog.tsx",
    "a dialog body",
  ],
  [
    "apps/web/src/components/schedule/schedule-view-tab.tsx",
    "Assign's position list column",
  ],
  [
    "apps/web/src/components/songs/chord-chart-import-dialog.tsx",
    "a dialog's preformatted preview",
  ],
  [
    "apps/web/src/components/songs/lyrics-search-panel.tsx",
    "a fixed-height results box",
  ],
  [
    "apps/web/src/components/songs/planning-center-pdf-preview.tsx",
    "the boxed PDF preview pane",
  ],
  [
    "apps/web/src/components/onboarding/welcome-dialog.tsx",
    "the welcome guide's body on short screens",
  ],
]);

const mainElementPattern = /<main\b/u;
const pageGutterPattern = /--page-gutter|\bpage-gutters\b/u;
const verticalScrollerPattern =
  /\boverflow-(?:y-)?(?:auto|scroll)\b|components\/ui\/scroll-area/u;

const walkFiles = (root: string): string[] =>
  readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(path);
    }
    return extname(entry.name) === ".tsx" && !entry.name.endsWith(".test.tsx")
      ? [path]
      : [];
  });

const productFiles = walkFiles(join(repositoryRoot, productSource))
  .map((path) => ({
    path: relative(repositoryRoot, path),
    contents: readFileSync(path, "utf8"),
  }))
  .filter(
    ({ path }) => path !== pageShellPath && !path.startsWith(sharedUiDirectory)
  );

/** Files matching `pattern`, minus `exceptions`; unused exceptions are violations too. */
const violationsOf = (
  pattern: RegExp,
  exceptions: Map<string, string>,
  fix: string
): string[] => {
  const matched = productFiles.filter(({ contents }) => pattern.test(contents));
  const matchedPaths = new Set(matched.map(({ path }) => path));
  return [
    ...matched
      .filter(({ path }) => !exceptions.has(path))
      .map(({ path }) => `${path}: ${fix}`),
    ...[...exceptions.keys()]
      .filter((path) => !matchedPaths.has(path))
      .map((path) => `${path} no longer matches; remove its exception`),
  ];
};

describe("page shell", () => {
  it("renders every inset page through PageShell", () => {
    expect(
      violationsOf(
        mainElementPattern,
        outsideInset,
        `render the page with PageShell from ${pageShellPath} instead of its own <main>`
      )
    ).toStrictEqual([]);
  });

  it("scrolls pages only through PageShell and PageScrollArea", () => {
    expect(
      violationsOf(
        verticalScrollerPattern,
        panelScrollers,
        `scroll the page with PageShell or PageScrollArea from ${pageShellPath}, so its scrollbar sits on the inset edge`
      )
    ).toStrictEqual([]);
  });

  it("leaves the page gutter to the shell", () => {
    expect(
      violationsOf(
        pageGutterPattern,
        new Map([[appShellPath, "sets the gutter for the inset"]]),
        `use PageShell or PageScrollArea from ${pageShellPath} instead of --page-gutter`
      )
    ).toStrictEqual([]);
  });
});
