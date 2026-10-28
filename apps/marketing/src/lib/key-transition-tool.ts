import { parseMusicalKey } from "@pcobooster/planning-center-models/key-theory";
import type { MusicalKey } from "@pcobooster/planning-center-models/key-theory";
import {
  rankAlternateKeys,
  rateKeyChange,
  transitionSuggestions,
} from "@pcobooster/planning-center-models/key-transition-advice";
import type {
  KeyChangeRating,
  KeyTransitionLevel,
  TransitionSuggestion,
} from "@pcobooster/planning-center-models/key-transition-advice";

import { keyChoicesFor } from "./key-transition-pages";
import type { KeyChoice } from "./key-transition-pages";

/*
 * The public key transition pages: the product's own key change rating and advice, for two
 * keys a visitor picks instead of two songs in a plan.
 */

const FIRST_SONG = "the first song";
const NEXT_SONG = "the next song";

export interface KeyTransitionAdvice {
  rating: KeyChangeRating;
  suggestions: TransitionSuggestion[];
  /** Nearby keys for the next song that come in smoothly, closest first. */
  alternates: KeyChoice[];
}

const musicalKeyOf = (choice: KeyChoice): MusicalKey => {
  const key = parseMusicalKey(choice);
  if (key === null) {
    throw new Error(`Unreadable key choice ${choice}`);
  }
  return key;
};

export const keyTransitionAdvice = (
  from: KeyChoice,
  to: KeyChoice
): KeyTransitionAdvice => {
  const fromKey = musicalKeyOf(from);
  const toKey = musicalKeyOf(to);
  const rating = rateKeyChange(fromKey, toKey);
  const songs = { fromTitle: FIRST_SONG, toTitle: NEXT_SONG, fromKey, toKey };
  const alternates =
    rating.level === "smooth"
      ? []
      : rankAlternateKeys(
          songs,
          keyChoicesFor(toKey.minor).map((choice) => ({
            key: musicalKeyOf(choice),
            value: choice,
          }))
        );
  return {
    rating,
    suggestions: transitionSuggestions(songs, rating.kind),
    alternates,
  };
};

/** How a change rates, without the advice: enough to mark a link to its page. */
export const keyChangeLevel = (
  from: KeyChoice,
  to: KeyChoice
): KeyTransitionLevel =>
  rateKeyChange(musicalKeyOf(from), musicalKeyOf(to)).level;

/** How each rating reads on the page, and the dot that marks it. */
export const LEVELS: Record<
  KeyTransitionLevel,
  { label: string; dot: string }
> = {
  smooth: { label: "Smooth", dot: "bg-status-confirmed" },
  "worth-a-look": { label: "Worth a look", dot: "bg-status-scheduled" },
  rough: { label: "Rough", dot: "bg-destructive" },
};
