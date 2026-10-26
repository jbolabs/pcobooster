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
import { Badge } from "./ui/badge";
import { Button, LinkButton } from "./ui/button";
import { Card, CardContent } from "./ui/card";
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
    <SelectTrigger aria-label={`${label}: ${keyLongName(value)}`} size="field">
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
 * A link to another change's page. It stays a real link, so every pair is crawlable, and on
 * the finder it can instead update the pair in place.
 */
const PairChip = ({
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
    <LinkButton
      href={pairPath(pair)}
      variant="outline"
      size="sm"
      title={LEVELS[level].label}
      className="pointer-coarse:h-10"
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
    </LinkButton>
  );
};

/** Links to other changes' pages, labelled the way people search ("G to A"). */
export const PairLinks = ({ pairs }: { pairs: readonly KeyPair[] }) => (
  <ul className="text-foreground flex flex-wrap gap-2">
    {pairs.map((pair) => (
      <li key={pairPath(pair)}>
        <PairChip pair={pair}>
          {pair.from} to {pair.to}
        </PairChip>
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
      <Card className="mx-auto max-w-[920px]">
        <CardContent>
          <div className="grid grid-cols-1 gap-6">
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
                variant="outline"
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
            <div
              className="border-border grid grid-cols-1 gap-6 border-t pt-6"
              aria-live="polite"
            >
              <div className="grid grid-cols-1 gap-2">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <h2 className="font-book flex items-center gap-3 text-3xl tracking-tight md:text-4xl">
                    {from}
                    <ArrowRight
                      aria-hidden="true"
                      className="text-muted-foreground size-6"
                    />
                    <span className="sr-only"> into </span>
                    {to}
                  </h2>
                  <Badge variant="outline">
                    <LevelDot level={rating.level} />
                    {level.label}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-base">
                  {rating.reason}.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <h3 className="text-muted-foreground text-sm font-medium">
                  {suggestions.length === 1
                    ? "One way to play it"
                    : `${suggestions.length} ways to play it`}
                </h3>
                <ol className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {suggestions.map((suggestion, index) => (
                    <li
                      key={suggestion.id}
                      className="bg-muted/60 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-3xl p-5"
                    >
                      <span
                        aria-hidden="true"
                        className="bg-background ring-foreground/10 text-foreground flex size-6 items-center justify-center rounded-full text-xs font-semibold ring-1"
                      >
                        {index + 1}
                      </span>
                      <h4 className="text-base leading-6 font-medium">
                        {suggestion.title}
                      </h4>
                      <p className="text-muted-foreground col-start-2 text-sm leading-relaxed">
                        {suggestion.segments.map((segment, segmentIndex) =>
                          segment.kind === "chord" ? (
                            // oxlint-disable-next-line react/no-array-index-key -- segments are a fixed sentence
                            <strong
                              key={segmentIndex}
                              className="bg-background text-foreground ring-foreground/10 rounded-md px-1 py-px font-semibold ring-1"
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
              </div>
              {alternates.length === 0 ? null : (
                <div className="bg-brand-soft/50 grid grid-cols-1 gap-3 rounded-3xl p-5 md:flex md:items-center md:justify-between">
                  <p className="text-sm">
                    <span className="font-medium">Want it smoother?</span>{" "}
                    <span className="text-muted-foreground">
                      Move the next song to a nearby key.
                    </span>
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {alternates.map((alternate) => (
                      <li key={alternate}>
                        <PairChip
                          pair={{ from, to: alternate }}
                          onSelect={onChange}
                        >
                          {alternate}
                        </PairChip>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="border-border text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-5 text-sm">
                PCOBooster checks every key change in your Planning Center plan.
                <TextLink href="/services" data-analytics-cta="key-transitions">
                  Open PCOBooster
                </TextLink>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
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

/** A section's heading column beside its content, as the site's other long sections lay out. */
export const LinkSection = ({
  title,
  intro,
  children,
}: {
  title: string;
  intro: ReactNode;
  children: ReactNode;
}) => (
  <section className="wrap pt-section grid grid-cols-1 gap-7 md:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] md:gap-12 lg:gap-24">
    <div className="grid grid-cols-1 content-start gap-5 self-start md:sticky md:top-24">
      <h2 className="text-headline">{title}</h2>
      {intro}
      <LevelLegend />
    </div>
    {children}
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
              <AccordionItem key={from} value={from}>
                <AccordionTrigger>From {keyLongName(from)}</AccordionTrigger>
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
