import type { KeyTransitionLevel } from "@pcobooster/planning-center-models/key-transition-advice";
import { ArrowLeftRight, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import {
  KEY_PAIRS,
  MAJOR_KEYS,
  MINOR_KEYS,
  isMinorChoice,
  keyLongName,
  pairPath,
} from "../lib/key-transition-pages";
import type { KeyChoice, KeyPair } from "../lib/key-transition-pages";
import {
  LEVELS,
  keyChangeLevel,
  keyTransitionAdvice,
} from "../lib/key-transition-tool";
import { ActionLink, TextLink } from "./site";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "./ui/select";

const KEY_GROUPS = [
  { label: "Major", keys: MAJOR_KEYS },
  { label: "Minor", keys: MINOR_KEYS },
] as const;

const LEVEL_ORDER: readonly KeyTransitionLevel[] = [
  "smooth",
  "worth-a-look",
  "rough",
];

const LevelDot = ({ level }: { level: KeyTransitionLevel }) => (
  <span
    aria-hidden="true"
    className={`size-2 shrink-0 rounded-full ${LEVELS[level].dot}`}
  />
);

/** What the dots on the key change links mean. */
const LevelLegend = () => (
  <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
    {LEVEL_ORDER.map((level) => (
      <li key={level} className="inline-flex items-center gap-1.5">
        <LevelDot level={level} />
        {LEVELS[level].label}
      </li>
    ))}
  </ul>
);

/** The key's name with its mode set apart ("Bb" and "major"); phones show the short "Bbm". */
const KeyName = ({ choice }: { choice: KeyChoice }) => {
  const minor = isMinorChoice(choice);
  return (
    <>
      {minor ? choice.slice(0, -1) : choice}
      {minor ? <span className="sm:hidden">m</span> : null}
      <span className="text-muted-foreground ml-1.5 hidden text-base tracking-normal sm:inline">
        {minor ? "minor" : "major"}
      </span>
    </>
  );
};

const KeySelect = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: KeyChoice;
  onChange: (choice: KeyChoice) => void;
}) => (
  <Select<KeyChoice>
    value={value}
    onValueChange={(choice) => {
      if (choice !== null) {
        onChange(choice);
      }
    }}
  >
    <SelectTrigger
      aria-label={`${label}: ${keyLongName(value)}`}
      variant="soft"
      size="field"
    >
      <span className="grid min-w-0 grid-cols-1 gap-0.5 text-left">
        <span className="text-muted-foreground text-xs font-medium">
          {label}
        </span>
        <span className="font-book truncate text-2xl tracking-tight">
          <KeyName choice={value} />
        </span>
      </span>
    </SelectTrigger>
    <SelectContent className="min-w-64">
      <div className="grid grid-cols-2 gap-x-1">
        {KEY_GROUPS.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.keys.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {choice}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </div>
    </SelectContent>
  </Select>
);

/**
 * A link to another change's page, marked with how smooth that change is. It stays a real link,
 * so every pair is crawlable, and on the finder it can instead update the pair in place.
 */
const PairLink = ({
  pair,
  children,
  onSelect,
}: {
  pair: KeyPair;
  children: ReactNode;
  onSelect?: (pair: KeyPair) => void;
}) => {
  const level = keyChangeLevel(pair.from, pair.to);
  return (
    <a
      href={pairPath(pair)}
      title={LEVELS[level].label}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 py-1 text-sm underline-offset-4 hover:underline pointer-coarse:py-2"
      onClick={
        onSelect === undefined
          ? undefined
          : (event) => {
              event.preventDefault();
              onSelect(pair);
            }
      }
    >
      <LevelDot level={level} />
      {children}
    </a>
  );
};

/** Links to other changes' pages in even columns, labelled the way people search ("G to A"). */
export const PairLinks = ({ pairs }: { pairs: readonly KeyPair[] }) => (
  <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-4">
    {pairs.map((pair) => (
      <li key={pairPath(pair)}>
        <PairLink pair={pair}>
          {pair.from} to {pair.to}
        </PairLink>
      </li>
    ))}
  </ul>
);

/**
 * Two key pickers and the advice for the change between them. The page owns the pair: the
 * finder page keeps it in state, a pair's own page moves to the new pair's URL.
 */
export const KeyTransitionFinder = ({
  from,
  to,
  onChange,
}: KeyPair & { onChange: (pair: KeyPair) => void }) => {
  const { rating, suggestions, alternates } = keyTransitionAdvice(from, to);
  const level = LEVELS[rating.level];

  return (
    <section aria-label="Key transition finder" className="wrap mt-12 md:mt-16">
      <div className="mx-auto grid max-w-[920px] grid-cols-1 gap-12">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 md:gap-4">
          <KeySelect
            label="First song"
            value={from}
            onChange={(choice) => {
              onChange({ from: choice, to });
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Swap the two keys"
            onClick={() => {
              onChange({ from: to, to: from });
            }}
          >
            <ArrowLeftRight aria-hidden="true" />
          </Button>
          <KeySelect
            label="Next song"
            value={to}
            onChange={(choice) => {
              onChange({ from, to: choice });
            }}
          />
        </div>
        <div className="grid grid-cols-1 gap-10" aria-live="polite">
          <div className="grid grid-cols-1 gap-2">
            <h2 className="font-book flex items-center gap-3 text-3xl tracking-tight md:text-4xl">
              {from}
              <ArrowRight
                aria-hidden="true"
                className="text-muted-foreground size-6"
              />
              <span className="sr-only"> into </span>
              {to}
            </h2>
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-base">
              <span className="text-foreground inline-flex items-center gap-2 font-medium">
                <LevelDot level={rating.level} />
                {level.label}.
              </span>
              {rating.reason}.
            </p>
          </div>
          <ol className="grid grid-cols-1 gap-x-12 gap-y-8 md:grid-cols-2">
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.id}
                className="grid grid-cols-[1.5rem_minmax(0,1fr)] content-start gap-x-2 gap-y-1"
              >
                <span
                  aria-hidden="true"
                  className="text-muted-foreground text-base leading-6 tabular-nums"
                >
                  {index + 1}.
                </span>
                <h3 className="text-base leading-6 font-medium">
                  {suggestion.title}
                </h3>
                <p className="text-muted-foreground col-start-2 text-sm leading-relaxed">
                  {suggestion.segments.map((segment, segmentIndex) =>
                    segment.kind === "chord" ? (
                      // oxlint-disable-next-line react/no-array-index-key -- segments are a fixed sentence
                      <strong
                        key={segmentIndex}
                        className="text-foreground font-semibold"
                      >
                        {segment.text}
                      </strong>
                    ) : (
                      // oxlint-disable-next-line react/no-array-index-key -- segments are a fixed sentence
                      <span key={segmentIndex}>{segment.text}</span>
                    )
                  )}
                </p>
              </li>
            ))}
          </ol>
          {alternates.length === 0 ? null : (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              <span className="text-muted-foreground">
                Smoother: move the next song to
              </span>
              <ul className="flex flex-wrap gap-x-5">
                {alternates.map((alternate) => (
                  <li key={alternate}>
                    <PairLink
                      pair={{ from, to: alternate }}
                      onSelect={onChange}
                    >
                      {alternate}
                    </PairLink>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            PCOBooster checks every key change in your Planning Center plan.
            <TextLink href="/services" data-analytics-cta="key-transitions">
              Open PCOBooster
            </TextLink>
          </p>
        </div>
      </div>
    </section>
  );
};

export const KeyTransitionsClosing = () => (
  <section className="wrap pt-section">
    <div className="bg-stage py-band grid grid-cols-1 justify-items-center gap-7 rounded-xl px-6 text-center md:rounded-3xl">
      <h2 className="text-closing">
        Every key change in your set,
        <br />
        <em>checked for you.</em>
      </h2>
      <ActionLink>Open PCOBooster</ActionLink>
    </div>
  </section>
);

/** A heading over a section of key change links, as wide as the finder card above it. */
export const LinkSection = ({
  title,
  intro,
  children,
}: {
  title: string;
  intro: ReactNode;
  children: ReactNode;
}) => (
  <section className="wrap pt-section">
    <div className="mx-auto grid max-w-[920px] grid-cols-1 gap-8">
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="grid grid-cols-1 gap-3">
          <h2 className="text-headline">{title}</h2>
          {intro}
        </div>
        <LevelLegend />
      </div>
      {children}
    </div>
  </section>
);

/**
 * Every change's page, grouped by starting key, so each one is a link away from the finder.
 * Closed panels stay in the prerendered HTML, so search engines still read every link.
 */
export const AllTransitions = () => (
  <LinkSection
    title="Every key change"
    intro={
      <p className="text-muted-foreground max-w-[420px]">
        Each pair of keys has its own page with the advice for that change.
      </p>
    }
  >
    <div className="grid grid-cols-1 items-start gap-x-10 gap-y-8 sm:grid-cols-2">
      {KEY_GROUPS.map((group) => (
        <div key={group.label} className="grid grid-cols-1 gap-2">
          <h3 className="text-muted-foreground text-sm font-medium">
            From a {group.label.toLowerCase()} key
          </h3>
          <Accordion multiple>
            {group.keys.map((from) => (
              <AccordionItem key={from} value={from} variant="plain">
                <AccordionTrigger size="compact">
                  From {keyLongName(from)}
                </AccordionTrigger>
                <AccordionContent variant="links">
                  <PairLinks
                    pairs={KEY_PAIRS.filter(
                      (pair) => pair.from === from && pair.to !== from
                    )}
                  />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      ))}
    </div>
  </LinkSection>
);
