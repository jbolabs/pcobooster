import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { parseJsxElements, stringLiterals } from "./jsx-elements";
import type { JsxElement } from "./jsx-elements";

/**
 * What keeps a file the biggest thing on a phone (see docs/mobile-native-audit.md, "File
 * viewer"): inside a full-screen viewer dialog, frames, padding, and gaps start at `sm:`, and
 * the PDF reader zooms itself under the fingers instead of leaving pinch to the page.
 */
const repositoryRoot = join(import.meta.dirname, "..");
const webSource = join(repositoryRoot, "apps/web/src");

const tsxFiles = (root: string): string[] =>
  readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return tsxFiles(path);
    }
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.")
      ? [path]
      : [];
  });

/** Spacing steps above 2 (8px) cost a phone screen; 2 and under is breathing room. */
const roomyStep = 2;

/** A phone-wide class (unprefixed or `max-*`) that frames the content or spends space on it. */
const chromePattern =
  /^(?:max-[\w-]+:)?(?:(?<frame>border(?:-[xytblr])?|rounded(?:-[\w]+)?)|(?:p[xytblr]?|gap(?:-[xy])?|p[tb]-safe)-(?<step>\d+(?:\.\d+)?))$/u;

const phoneChrome = (token: string): boolean => {
  const match = chromePattern.exec(token);
  if (match?.groups === undefined) {
    return false;
  }
  if (match.groups.frame !== undefined) {
    return !token.includes("rounded-none") && !token.endsWith("border-0");
  }
  return Number(match.groups.step) > roomyStep;
};

const isViewer = (element: JsxElement): boolean =>
  element.tag === "DialogContent" &&
  stringLiterals(element.attributes.get("variant")).includes("viewer");

/** Problems inside a file's viewer dialogs. */
const viewerProblems = (path: string): string[] => {
  const source = readFileSync(join(webSource, path), "utf8");
  if (!source.includes('variant="viewer"')) {
    return [];
  }
  return parseJsxElements(path, source)
    .filter(({ ancestors }) => ancestors.some(isViewer))
    .flatMap(({ tag, classes }) => [
      ...classes
        .filter(phoneChrome)
        .map(
          (token) =>
            `${path}: <${tag}> \`${token}\` frames or pads the file on phones; start it at sm:`
        ),
      ...(tag === "DialogFooter"
        ? [
            `${path}: <DialogFooter> stacks full-width rows under the file on phones; lay song steps out in one row`,
          ]
        : []),
    ]);
};

describe("file viewer on phones", () => {
  it("gives the file the screen inside viewer dialogs", () => {
    expect(
      tsxFiles(webSource).flatMap((path) =>
        viewerProblems(relative(webSource, path))
      )
    ).toStrictEqual([]);
  });

  it("zooms PDFs in the reader, edge to edge, with page scrolling left alone", () => {
    const path = "components/schedule/file-pdf-reader.tsx";
    const scroller = parseJsxElements(
      path,
      readFileSync(join(webSource, path), "utf8")
    ).find(({ classes }) => classes.includes("overflow-auto"));
    const classes = scroller?.classes ?? [];
    expect({
      // Pans stay native; pinch belongs to the reader, which zooms the page itself.
      touch: classes.filter((token) => token.startsWith("touch-")).toSorted(),
      phonePadding: classes.filter(
        (token) => /^p[xlr]?-/u.test(token) && phoneChrome(token)
      ),
    }).toStrictEqual({
      touch: ["touch-pan-x", "touch-pan-y"],
      phonePadding: [],
    });
  });
});
