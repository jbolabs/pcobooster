/*
 * The keys a visitor can pick on the key transition finder, and the URL of the page for
 * every pair of them. Free of package imports so `vite.config.ts` can list the pages to
 * prerender.
 */

/** The twelve tonics as bands read them in each mode (Bb and F#, Ebm and G#m). */
export const MAJOR_KEYS = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;
export const MINOR_KEYS = [
  "Cm",
  "C#m",
  "Dm",
  "Ebm",
  "Em",
  "Fm",
  "F#m",
  "Gm",
  "G#m",
  "Am",
  "Bbm",
  "Bm",
] as const;

export type KeyChoice =
  | (typeof MAJOR_KEYS)[number]
  | (typeof MINOR_KEYS)[number];

export const ALL_KEYS: readonly KeyChoice[] = [...MAJOR_KEYS, ...MINOR_KEYS];

export const keyChoicesFor = (minor: boolean): readonly KeyChoice[] =>
  minor ? MINOR_KEYS : MAJOR_KEYS;

export const isMinorChoice = (choice: KeyChoice): boolean =>
  choice.endsWith("m");

const ACCIDENTAL_WORDS = new Map([
  ["b", "flat"],
  ["#", "sharp"],
]);

const keyParts = (choice: KeyChoice) => {
  const minor = isMinorChoice(choice);
  const tonic = minor ? choice.slice(0, -1) : choice;
  return {
    letter: tonic.charAt(0),
    accidental: ACCIDENTAL_WORDS.get(tonic.slice(1)),
    minor,
  };
};

/** "B-flat major", "C-sharp minor": how a key is written out in a sentence. */
export const keyLongName = (choice: KeyChoice): string => {
  const { letter, accidental, minor } = keyParts(choice);
  const tonic = accidental === undefined ? letter : `${letter}-${accidental}`;
  return `${tonic} ${minor ? "minor" : "major"}`;
};

/** "b-flat", "c-sharp-minor": a key as it reads in a URL. */
export const keySlug = (choice: KeyChoice): string => {
  const { letter, accidental, minor } = keyParts(choice);
  return [letter.toLowerCase(), accidental, minor ? "minor" : undefined]
    .filter((part) => part !== undefined)
    .join("-");
};

export const KEY_TRANSITIONS_PATH = "/key-transitions";

export interface KeyPair {
  from: KeyChoice;
  to: KeyChoice;
}

/** Both songs in one key: the finder offers it, but search engines skip its page. */
export const isSameKey = ({ from, to }: KeyPair): boolean => from === to;

export const pairSlug = ({ from, to }: KeyPair): string =>
  `${keySlug(from)}-to-${keySlug(to)}`;

/** The page for one change, such as `/key-transitions/g-to-b-flat`. */
export const pairPath = (pair: KeyPair): string =>
  `${KEY_TRANSITIONS_PATH}/${pairSlug(pair)}`;

/**
 * Every pair of keys, starting key first, in picker order. Staying in one key gets a page too,
 * so picking the same key twice on a pair's page still lands somewhere.
 */
export const KEY_PAIRS: readonly KeyPair[] = ALL_KEYS.flatMap((from) =>
  ALL_KEYS.map((to) => ({ from, to }))
);

const PAIRS_BY_SLUG = new Map(KEY_PAIRS.map((pair) => [pairSlug(pair), pair]));

/** The pair a page URL names; undefined for anything else. */
export const pairFromSlug = (slug: string): KeyPair | undefined =>
  PAIRS_BY_SLUG.get(slug);
