import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";

import {
  KeyTransitionFinder,
  KeyTransitionsClosing,
  PairLinks,
} from "../components/key-transition-finder";
import { TextLink } from "../components/site";
import {
  KEY_PAIRS,
  KEY_TRANSITIONS_PATH,
  keyLongName,
  pairFromSlug,
  pairPath,
  pairSlug,
} from "../lib/key-transition-pages";
import type { KeyPair } from "../lib/key-transition-pages";
import { keyTransitionAdvice } from "../lib/key-transition-tool";
import { pageHead, socialPreviewOf } from "../lib/site-head";

type AssertPair = (pair: KeyPair | undefined) => asserts pair is KeyPair;

/** A slug that names no pair renders the not-found page, as the route never existed. */
const assertPair: AssertPair = (pair) => {
  if (pair === undefined) {
    notFound({ throw: true });
  }
};

const lowerFirst = (value: string) =>
  `${value.charAt(0).toLowerCase()}${value.slice(1)}`;

/** The search title and summary for one change: "G to Bb key change", what it is, how to play it. */
const pairSummary = ({ from, to }: KeyPair) => {
  const { rating, suggestions } = keyTransitionAdvice(from, to);
  const ideas =
    suggestions.length === 1
      ? "a chord-by-chord way"
      : `${suggestions.length} chord-by-chord ways`;
  if (from === to) {
    return {
      title: `Staying in ${from} between songs`,
      description: `Two songs in ${keyLongName(from)} back to back: ${ideas} to keep your band moving from one into the next.`,
    };
  }
  return {
    title: `${from} to ${to} key change`,
    description: `How to transition between songs from ${keyLongName(from)} to ${keyLongName(to)} (${lowerFirst(rating.reason)}), with ${ideas} to take your band there.`,
  };
};

const PairPage = () => {
  const pair = Route.useLoaderData();
  const navigate = useNavigate();
  const { from, to } = pair;
  const others = KEY_PAIRS.filter(
    (other) => other.from !== other.to && pairSlug(other) !== pairSlug(pair)
  );

  return (
    <main id="main" className="pt-page-top">
      <header className="wrap max-w-[760px] text-center">
        <h1 className="text-display">
          {from} to {to}
          <br />
          <em>key change.</em>
        </h1>
        <p className="text-muted-foreground text-lede mx-auto mt-6 max-w-[560px]">
          From a song in {keyLongName(from)} into one in {keyLongName(to)}.
        </p>
      </header>
      <KeyTransitionFinder
        from={from}
        to={to}
        onChange={(next) => {
          void navigate({
            to: "/key-transitions/$pair",
            params: { pair: pairSlug(next) },
            replace: true,
            resetScroll: false,
          });
        }}
      />
      <section className="wrap pt-section grid grid-cols-1 gap-7 md:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] md:gap-12 lg:gap-24">
        <div className="self-start md:sticky md:top-24">
          <h2 className="text-headline mb-5">More key changes</h2>
          <TextLink href={KEY_TRANSITIONS_PATH}>
            Every key change in one place
          </TextLink>
        </div>
        <div className="grid grid-cols-1 gap-8">
          {from === to ? null : (
            <div className="border-border grid grid-cols-1 gap-3 border-t pt-6">
              <h3 className="text-lg font-medium">The other way around</h3>
              <PairLinks pairs={[{ from: to, to: from }]} />
            </div>
          )}
          <div className="border-border grid grid-cols-1 gap-3 border-t pt-6">
            <h3 className="text-lg font-medium">From {from} into</h3>
            <PairLinks pairs={others.filter((other) => other.from === from)} />
          </div>
          <div className="border-border grid grid-cols-1 gap-3 border-t pt-6">
            <h3 className="text-lg font-medium">Into {to} from</h3>
            <PairLinks pairs={others.filter((other) => other.to === to)} />
          </div>
        </div>
      </section>
      <KeyTransitionsClosing />
    </main>
  );
};

export const Route = createFileRoute("/key-transitions_/$pair")({
  loader: ({ params }) => {
    const pair = pairFromSlug(params.pair);
    assertPair(pair);
    return pair;
  },
  head: ({ loaderData }) => {
    if (loaderData === undefined) {
      return {};
    }
    const { title, description } = pairSummary(loaderData);
    return pageHead({
      title,
      description,
      pathname: pairPath(loaderData),
      preview: {
        ...socialPreviewOf("/key-transitions"),
        title: `${title} | PCOBooster`,
        description,
      },
    });
  },
  component: PairPage,
});
