import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..");
const sourceExtensions = new Set([".ts", ".tsx"]);
const ignoredDirectories = new Set(["dist", "node_modules"]);

/**
 * Product and API code. Workers and CI run in UTC while browsers run in the viewer's zone, so
 * any date formatted in the host zone shows congregation dates on the wrong day somewhere.
 */
const checkedRoots = [
  "packages/api/src",
  "packages/planning-center-models/src",
  "packages/contracts/src",
  "apps/server/src",
  "apps/web/src",
];

const intlDateTimeFormatPattern = /\bIntl\.DateTimeFormat\(/gu;
/** Host-zone formatting and local-time getters that ignore the org zone. */
const hostZonePattern =
  /\.(?:toLocaleDateString|toLocaleTimeString|toLocaleString|getFullYear|getMonth|getDate|getDay|getHours|getMinutes)\(/gu;

/** Files allowed to read the host zone, and why the value there is not an instant. */
const hostZoneExceptions = new Map([
  [
    "apps/web/src/components/ui/calendar.tsx",
    "react-day-picker days are local-midnight carriers for civil dates, not instants",
  ],
]);

/** The text of a call's arguments, from the opening parenthesis to its match. */
const callArguments = (contents: string, openIndex: number): string => {
  let depth = 0;
  for (let index = openIndex; index < contents.length; index += 1) {
    const character = contents[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return contents.slice(openIndex, index + 1);
      }
    }
  }
  return contents.slice(openIndex);
};

const lineOf = (contents: string, index: number): number =>
  contents.slice(0, index).split("\n").length;

/** Describes each place a module formats or reads a date in the host zone. */
const hostZoneDateFormatting = (contents: string): string[] => {
  const findings: string[] = [];
  for (const match of contents.matchAll(intlDateTimeFormatPattern)) {
    const openIndex = match.index + match[0].length - 1;
    if (!/\btimeZone\b/u.test(callArguments(contents, openIndex))) {
      findings.push(
        `line ${lineOf(contents, match.index)}: Intl.DateTimeFormat without a timeZone option`
      );
    }
  }
  for (const match of contents.matchAll(hostZonePattern)) {
    findings.push(
      `line ${lineOf(contents, match.index)}: ${match[0].slice(1, -1)} reads the host zone`
    );
  }
  return findings;
};

const walkFiles = (root: string): string[] =>
  readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || ignoredDirectories.has(entry.name)) {
      return [];
    }
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(path);
    }
    return sourceExtensions.has(extname(entry.name)) &&
      !/\.test\.tsx?$/u.test(entry.name)
      ? [path]
      : [];
  });

describe("time zone formatting", () => {
  it("finds host-zone formatters but not zoned ones", () => {
    expect(
      hostZoneDateFormatting(
        [
          'const a = new Intl.DateTimeFormat("en-US", { month: "short" });',
          "const b = new Intl.DateTimeFormat('en-US', {",
          "  timeZone,",
          "  day: 'numeric',",
          "});",
          'const c = Intl.DateTimeFormat("en-US", { timeZone: tz });',
          "const d = Intl.DateTimeFormat().resolvedOptions().timeZone;",
          "const e = date.getDate() + date.getUTCDate();",
          "const f = date.toLocaleDateString();",
        ].join("\n")
      )
    ).toStrictEqual([
      "line 1: Intl.DateTimeFormat without a timeZone option",
      "line 7: Intl.DateTimeFormat without a timeZone option",
      "line 8: getDate reads the host zone",
      "line 9: toLocaleDateString reads the host zone",
    ]);
  });

  it("formats dates with an explicit time zone", () => {
    const violations: string[] = [];
    const matchedExceptions = new Set<string>();

    for (const root of checkedRoots) {
      for (const path of walkFiles(join(repositoryRoot, root))) {
        const relativePath = relative(repositoryRoot, path);
        const findings = hostZoneDateFormatting(readFileSync(path, "utf8"));
        if (findings.length === 0) {
          continue;
        }
        if (hostZoneExceptions.has(relativePath)) {
          matchedExceptions.add(relativePath);
          continue;
        }
        for (const finding of findings) {
          violations.push(
            `${relativePath} ${finding}; format congregation dates with formatCalendarDateLabel and the org time zone`
          );
        }
      }
    }

    for (const exception of hostZoneExceptions.keys()) {
      if (!matchedExceptions.has(exception)) {
        violations.push(
          `${exception} no longer reads the host zone; remove its exception`
        );
      }
    }

    expect(violations).toStrictEqual([]);
  });
});
