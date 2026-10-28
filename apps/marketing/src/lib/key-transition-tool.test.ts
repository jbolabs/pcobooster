import { describe, expect, it } from "vitest";

import { keyChangeLevel, keyTransitionAdvice } from "./key-transition-tool";

const adviceLines = (
  from: Parameters<typeof keyTransitionAdvice>[0],
  to: Parameters<typeof keyTransitionAdvice>[1]
) =>
  keyTransitionAdvice(from, to).suggestions.map(
    (suggestion) =>
      `${suggestion.title}: ${suggestion.segments.map((segment) => segment.text).join("")}`
  );

describe(keyTransitionAdvice, () => {
  it("rates G into Bb as a third worth a look, held together by their shared D", () => {
    const advice = keyTransitionAdvice("G", "Bb");
    expect(advice.rating).toStrictEqual({
      level: "worth-a-look",
      kind: "mediant",
      reason: "Up a minor third: shares only D",
    });
    expect(adviceLines("G", "Bb")[0]).toBe(
      "Hold a note across: End the first song on G, but hold the D (its fifth). It becomes the third of the next song's opening Bb chord."
    );
  });

  it("offers nearby next-song keys that come in smoothly, closest first", () => {
    // From G, A is a whole-step lift and Ab a half-step lift; C is the IV.
    expect(keyTransitionAdvice("G", "Bb").alternates).toStrictEqual([
      "A",
      "Ab",
      "C",
    ]);
  });

  it("walks a whole-step lift up through the chord both keys share", () => {
    const advice = keyTransitionAdvice("G", "A");
    expect(advice.rating.level).toBe("smooth");
    expect(advice.alternates).toStrictEqual([]);
    expect(adviceLines("G", "A")[0]).toBe(
      "Walk up: End the first song on G, play D (the V of G and the IV of A), then E into the next song in A."
    );
  });

  it("calls a half step down rough and suggests singing the songs the other way round", () => {
    const advice = keyTransitionAdvice("E", "Eb");
    expect(advice.rating).toStrictEqual({
      level: "rough",
      kind: "half-step-down",
      reason: "Down a half step: sounds flat without a setup",
    });
    expect(adviceLines("E", "Eb")).toContain(
      "Swap them: Sing the next song before the first song, so the same change becomes a lift up."
    );
  });

  it("treats a minor key and its relative major as smooth", () => {
    expect(keyTransitionAdvice("Em", "G").rating).toStrictEqual({
      level: "smooth",
      kind: "relative",
      reason: "Relative key: same key signature",
    });
  });
});

describe(keyChangeLevel, () => {
  it.each([
    // The relative major shares every note with E minor.
    ["Em", "C", "smooth"],
    // A minor third apart, sharing only D.
    ["G", "Bb", "worth-a-look"],
    // A tritone apart: the farthest two keys can be.
    ["G", "Db", "rough"],
  ] as const)("rates %s into %s as %s", (from, to, level) => {
    expect(keyChangeLevel(from, to)).toBe(level);
  });
});
