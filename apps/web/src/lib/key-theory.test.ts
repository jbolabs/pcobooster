import {
  chordName,
  circleOfFifthsDistance,
  commonToneChords,
  commonTones,
  dominantIsIn,
  dominantSeventhOf,
  keyName,
  noteName,
  parseMusicalKey,
  pivotChords,
  predominantOf,
  scaleOf,
  semitonesUp,
} from "@pcobooster/planning-center-models/key-theory";
import type { MusicalKey } from "@pcobooster/planning-center-models/key-theory";
import { describe, expect, it } from "vitest";

const key = (value: string): MusicalKey => {
  const parsed = parseMusicalKey(value);
  if (parsed === null) {
    throw new Error(`Not a key: ${value}`);
  }
  return parsed;
};

describe(parseMusicalKey, () => {
  it("reads sharps, flats, and minor keys, and rejects names that are not keys", () => {
    expect(keyName(key("Eb"))).toBe("Eb");
    expect(keyName(key("F#m"))).toBe("F#m");
    expect(keyName(key("Bbmin"))).toBe("Bbm");
    expect(parseMusicalKey("(Female Lead) John")).toBeNull();
  });

  it("lets Planning Center's minor flag override the name", () => {
    expect(parseMusicalKey("A", true)?.minor).toBeTruthy();
  });
});

describe(scaleOf, () => {
  it("spells every degree on its own letter", () => {
    expect(scaleOf(key("F#")).map(noteName)).toStrictEqual([
      "F#",
      "G#",
      "A#",
      "B",
      "C#",
      "D#",
      "E#",
    ]);
    expect(scaleOf(key("Db")).map(noteName)).toStrictEqual([
      "Db",
      "Eb",
      "F",
      "Gb",
      "Ab",
      "Bb",
      "C",
    ]);
  });
});

describe(dominantSeventhOf, () => {
  it("names the chord a fifth above in the new key's spelling", () => {
    expect(chordName(dominantSeventhOf(key("F")))).toBe("C7");
    expect(chordName(dominantSeventhOf(key("Db")))).toBe("Ab7");
    expect(chordName(dominantSeventhOf(key("F#")))).toBe("C#7");
    expect(chordName(dominantSeventhOf(key("Am")))).toBe("E7");
  });
});

const pivots = (from: string, to: string) =>
  pivotChords(key(from), key(to)).map(
    ({ chord, borrowed }) =>
      `${chordName(chord)} (${chord.numeral}${borrowed ? ", borrowed" : ""})`
  );

describe(pivotChords, () => {
  it("lists setup chords both keys share, strongest first", () => {
    expect(pivots("G", "D")).toStrictEqual(["Em (ii)", "G (IV)", "Bm (vi)"]);
    expect(pivots("C", "Bb")).toStrictEqual(["Dm (iii)"]);
  });

  it("borrows from the parallel minor when a major key shares nothing", () => {
    expect(pivots("C", "Eb")).toStrictEqual([
      "Fm (ii, borrowed)",
      "Ab (IV, borrowed)",
      "Cm (vi, borrowed)",
      "Gm (iii, borrowed)",
    ]);
    expect(pivots("C", "Fm")[0]).toBe("Ab (III, borrowed)");
  });

  it("finds nothing to share between keys a tritone apart", () => {
    expect(pivotChords(key("C"), key("F#"))).toStrictEqual([]);
  });
});

describe("setup chords", () => {
  it("names the predominant and spots a dominant the first key already has", () => {
    expect(chordName(predominantOf(key("D")))).toBe("Em");
    expect(chordName(predominantOf(key("Am")))).toBe("Dm");
    expect(dominantIsIn(key("C"), key("Bb"))).toBeTruthy();
    expect(dominantIsIn(key("C"), key("E"))).toBeFalsy();
  });

  it("respells theoretical major keys and keeps minor ones", () => {
    expect(keyName(key("A#"))).toBe("Bb");
    expect(keyName(key("G#m"))).toBe("G#m");
  });
});

describe(commonTones, () => {
  it("names notes both home chords hold, in the new key's spelling", () => {
    expect(commonTones(key("C"), key("E")).map(noteName)).toStrictEqual(["E"]);
    expect(commonTones(key("Bb"), key("E")).map(noteName)).toStrictEqual([]);
  });
});

describe("distance between keys", () => {
  it("measures semitones up and circle of fifths steps", () => {
    expect(semitonesUp(key("Bb"), key("E"))).toBe(6);
    expect(circleOfFifthsDistance(key("Bb"), key("E"))).toBe(6);
    expect(circleOfFifthsDistance(key("Am"), key("C"))).toBe(0);
    expect(circleOfFifthsDistance(key("G"), key("D"))).toBe(1);
  });
});

const describeTone = (from: string, to: string) => {
  const [first] = commonToneChords(key(from), key(to));
  return first === undefined
    ? null
    : `${noteName(first.fromTone)}, ${first.fromRole} of ${chordName(first.from)} -> ${first.toRole} of ${chordName(first.to)}`;
};

describe(commonToneChords, () => {
  it("tries the home chords first", () => {
    expect(describeTone("F", "D")).toBe("A, third of F -> fifth of D");
  });

  it("prefers a held note that lands as the opening chord's root", () => {
    expect(describeTone("F", "E")).toBe("A, third of F -> root of A");
  });

  it("then steps both songs off their home chords", () => {
    expect(describeTone("Bb", "E")).toBe("A, third of F -> root of A");
  });
});
