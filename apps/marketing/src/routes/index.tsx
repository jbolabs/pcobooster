import { StarField } from "@pcobooster/ui/star-field";
import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { DemoFrame } from "../components/demo-frame";
import { FeatureTiles } from "../components/feature-tiles";
import {
  ChooseGraphic,
  ConnectGraphic,
  FitGraphic,
} from "../components/graphics/illustrations";
import { LoopWhenVisible } from "../components/graphics/loop-when-visible";
import { RocketMark } from "../components/graphics/rocket-mark";
import {
  ChordChartShowcase,
  HistoryShowcase,
  LineupShowcase,
  PeopleShowcase,
  ProductDemo,
} from "../components/product-demo/product-demo";
import { ActionLink, CONTACT_URL, TextLink } from "../components/site";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../components/ui/accordion";
import { Badge } from "../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { pageHead } from "../lib/site-head";

const DEMO_ANCHOR = "product";

const questions = [
  {
    question: "Who is PCOBooster for?",
    answer:
      "Ministry leaders whose church already runs on Planning Center Services: worship leaders, team leaders and schedulers, production leads, and the pastors and staff who keep each Sunday on track. If you spend your week in Services, PCOBooster is built to make that week shorter.",
  },
  {
    question: "Does this replace Planning Center?",
    answer:
      "No. Planning Center Services stays the home for your plans, people, and songs. PCOBooster is the workspace on top of it: it reads what’s already there and writes your changes straight back, so everyone else on your team keeps using Planning Center the way they do today.",
  },
  {
    question: "What does it change in Planning Center?",
    answer:
      "Only what you change. Scheduling someone, marking a response, editing the order of service, setting a key, adjusting a time, or saving a chord chart writes to Planning Center, just as if you’d done it there. There’s nothing to import, and nothing to keep in sync.",
  },
  {
    question: "What does beta mean here?",
    answer:
      "Scheduling, team health, the run sheet, service times, and chord charts all work today and save to Planning Center. It’s still early, so expect rough edges and changes as it grows. If something breaks or feels off, the feedback button in the app’s sidebar goes straight to Jake.",
  },
  {
    question: "Is this an official Planning Center product?",
    answer:
      "No. PCOBooster is independently built and operated. We use the Planning Center API, but are not affiliated with, sponsored by, or endorsed by Planning Center.",
  },
  {
    question: "What do I need to get started?",
    answer:
      "A Planning Center account with access to Services. Sign in with Planning Center and your plans are there right away. PCOBooster works within the access your account already has, so people only see and change what Planning Center lets them.",
  },
  {
    question: "How much will it cost?",
    answer:
      "Nothing during beta. We may add paid plans later. If we do, we’ll tell you ahead of time, and nothing will be charged unless you opt in. Since everything saves straight to Planning Center, there’s no lock-in.",
  },
];

const steps = [
  {
    title: "Sign in with Planning Center",
    description:
      "Use Planning Center’s own sign-in. Your services, teams, people, and songs are there the moment you connect.",
    graphic: <ConnectGraphic />,
  },
  {
    title: "Work from one clear view",
    description:
      "Plans, availability, serving history, and charts sit side by side, so the next decision is never three tabs away.",
    graphic: <ChooseGraphic />,
  },
  {
    title: "Changes save to Planning Center",
    description:
      "Every assignment, key, time, and chart goes straight back. Your team keeps using Planning Center like always.",
    graphic: <FitGraphic />,
  },
];

const pricingChecks = [
  "Every feature, for everyone on your team",
  "Nothing charged unless you choose a plan",
  "Everything stays in Planning Center, so you can stop anytime",
];

const teamChecks = [
  "Availability, blockouts, and conflicts before you ask",
  "Four weeks back and four ahead for every candidate",
  "Rankings that honor the preferences volunteers set in Planning Center",
  "Assignments and responses saved straight to Planning Center",
];

const musicChecks = [
  "Transpose a whole chart in one step",
  "Import a SongSelect or ChordPro file, or chords written above lyrics",
  "Preview in any key beside Planning Center’s print layout",
  "Find the songs your church hasn’t sung in six months or more",
];

const SectionHeading = ({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) => (
  <header className="reveal mb-7 grid grid-cols-1 items-end gap-5 md:mb-10 md:grid-cols-[minmax(0,1fr)_minmax(0,380px)] md:gap-10 lg:gap-16">
    <h2 className="text-headline">{title}</h2>
    <p className="text-muted-foreground pb-1">{children}</p>
  </header>
);

/** Checked items; `divided` sets them under a rule after a paragraph above. */
const Checklist = ({
  items,
  divided = true,
}: {
  items: readonly string[];
  divided?: boolean;
}) => (
  <ul
    className={
      divided
        ? "border-border mt-7 grid grid-cols-1 gap-3 border-t pt-6"
        : "grid grid-cols-1 gap-3"
    }
  >
    {items.map((item) => (
      <li key={item} className="flex items-start gap-3 text-sm">
        <span aria-hidden="true" className="flex h-lh shrink-0 items-center">
          <span className="bg-brand-soft text-brand grid size-5.5 grid-cols-1 place-items-center rounded-full">
            <Check className="size-3.5" strokeWidth={2.5} />
          </span>
        </span>
        {item}
      </li>
    ))}
  </ul>
);

const Stage = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={`reveal bg-stage p-stage min-w-0 rounded-xl md:rounded-3xl ${className ?? ""}`}
  >
    {children}
  </div>
);

const TryHint = ({ children }: { children: ReactNode }) => (
  <p className="text-muted-foreground mt-4 text-center text-xs">{children}</p>
);

const Hero = () => (
  <section className="wrap md:pt-hero-top md:pb-hero-bottom grid grid-cols-1 items-end gap-6 pt-12 pb-10 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:gap-10 lg:gap-16">
    <div>
      <h1 className="text-display">
        Planning Center,
        <br />
        <em>boosted.</em>
      </h1>
    </div>
    <div className="max-w-110 pb-1.5 md:justify-self-end">
      <p className="text-muted-foreground md:text-lede text-base">
        The workspace ministry leaders open every week to fill teams, look after
        volunteers, and get songs and charts ready for Sunday. It runs on the
        Planning Center Services you already use, and every change saves
        straight back.
      </p>
      <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-4">
        <ActionLink>Open PCOBooster</ActionLink>
        <TextLink href={`#${DEMO_ANCHOR}`} icon="down">
          Try it with sample data
        </TextLink>
      </div>
    </div>
  </section>
);

const HeroStage = () => (
  <section
    id={DEMO_ANCHOR}
    aria-label="Inside PCOBooster"
    className="wrap bg-stage p-stage relative isolate scroll-mt-20 overflow-hidden rounded-xl md:rounded-3xl"
  >
    <LoopWhenVisible className="absolute inset-0 -z-10">
      <StarField />
    </LoopWhenVisible>
    <div className="stage-rise">
      <DemoFrame label="Interactive PCOBooster replica">
        <ProductDemo />
      </DemoFrame>
    </div>
  </section>
);

const HowItWorks = () => (
  <section className="wrap pt-section" id="how-it-works">
    <SectionHeading
      title={
        <>
          Nothing to move.
          <br />
          <em>Nothing to sync.</em>
        </>
      }
    >
      Your plans, teams, and songs stay in Planning Center Services. PCOBooster
      gives you a faster way to work with them.
    </SectionHeading>
    <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.title} className="reveal flex">
          <Card className="w-full">
            <CardContent>
              <LoopWhenVisible className="bg-stage rounded-2xl px-2 py-3">
                {step.graphic}
              </LoopWhenVisible>
            </CardContent>
            <CardHeader>
              <div className="flex items-center gap-2.5">
                <span className="bg-brand-soft text-brand grid size-6 shrink-0 grid-cols-1 place-items-center rounded-full text-xs font-semibold tabular-nums">
                  {index + 1}
                </span>
                <CardTitle>
                  <h3>{step.title}</h3>
                </CardTitle>
              </div>
              <CardDescription>{step.description}</CardDescription>
            </CardHeader>
          </Card>
        </li>
      ))}
    </ol>
  </section>
);

const Teams = () => (
  <section className="wrap pt-section" id="features">
    <SectionHeading
      title={
        <>
          Every team, filled.
          <br />
          <em>With the right people.</em>
        </>
      }
    >
      See every team’s filled and open positions at once. Pick an open spot and
      PCOBooster lines up who to ask, then saves the assignment to Planning
      Center.
    </SectionHeading>
    <Stage className="overflow-hidden">
      <DemoFrame label="Lineup of scheduled people and open positions by team">
        <LineupShowcase demoAnchorId={DEMO_ANCHOR} />
      </DemoFrame>
    </Stage>
    <div className="pt-section grid grid-cols-1 items-center gap-9 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:gap-10 lg:gap-18">
      <div className="reveal">
        <h3 className="text-headline">
          A little history.
          <br />
          <em>A better ask.</em>
        </h3>
        <p className="text-muted-foreground mt-6">
          Look past an open calendar. Each person’s recent and upcoming serving
          sits beside their fit, so you don’t lean on the same five people or
          forget the one who hasn’t been asked in a while.
        </p>
        <Checklist items={teamChecks} />
      </div>
      <Stage className="pb-popover-room">
        <DemoFrame
          overflow="visible"
          label="Candidates for Acoustic Guitar with one person's recent serving history open"
        >
          <HistoryShowcase />
        </DemoFrame>
      </Stage>
    </div>
  </section>
);

const People = () => (
  <section className="wrap pt-section" id="people">
    <SectionHeading
      title={
        <>
          Care for your people.
          <br />
          <em>Not just the schedule.</em>
        </>
      }
    >
      Across every team you lead, see who’s waiting on a reply, who’s carrying
      too much, and who hasn’t served in a while. Catch burnout and drift before
      they turn into a no.
    </SectionHeading>
    <Stage className="overflow-hidden">
      <DemoFrame label="Team health with people to check in with">
        <PeopleShowcase />
      </DemoFrame>
    </Stage>
  </section>
);

const Music = () => (
  <section className="wrap pt-section" id="music">
    <SectionHeading
      title={
        <>
          Songs, keys, and charts.
          <br />
          <em>Ready before rehearsal.</em>
        </>
      }
    >
      Write and fix chord charts beside a live print preview, change keys in a
      click, and save to the arrangement in Planning Center, where your band
      already looks.
    </SectionHeading>
    <Stage className="overflow-visible">
      <DemoFrame
        overflow="visible"
        label="Chord chart editor with a live preview"
      >
        <ChordChartShowcase />
      </DemoFrame>
    </Stage>
    <TryHint>
      Try it: open Transpose and pick a new key, or edit a line and watch the
      preview follow.
    </TryHint>
    <div className="reveal mt-10 grid grid-cols-1 gap-x-16 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <p className="text-muted-foreground max-md:mb-6">
        For worship leaders and music directors who keep charts current every
        week, without exporting, retyping, or a second app.
      </p>
      <Checklist items={musicChecks} divided={false} />
    </div>
  </section>
);

const Extras = () => (
  <section className="wrap pt-section" id="more">
    <SectionHeading
      title={
        <>
          And the rest of the week,
          <br />
          <em>handled.</em>
        </>
      }
    >
      The small jobs that fill a planning week, each one a click from the plan
      you’re already on.
    </SectionHeading>
    <FeatureTiles demoAnchorId={DEMO_ANCHOR} />
  </section>
);

const Pricing = () => (
  <section className="wrap pt-section" id="pricing">
    <SectionHeading
      title={
        <>
          Use all of it, free.
          <br />
          <em>While we’re in beta.</em>
        </>
      }
    >
      Everything PCOBooster does works today at no cost. If paid plans come
      later, you’ll hear from us first.
    </SectionHeading>
    <div className="reveal">
      <Card className="md:grid md:grid-cols-2 md:grid-rows-[auto_minmax(0,1fr)]">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle variant="display">
              <h3>Beta</h3>
            </CardTitle>
            <Badge variant="brand">Free</Badge>
          </div>
          <CardDescription>
            For anyone whose church plans in Planning Center Services.
          </CardDescription>
        </CardHeader>
        <CardContent className="md:col-start-2 md:row-span-2 md:row-start-1 md:self-center">
          <Checklist items={pricingChecks} divided={false} />
        </CardContent>
        <CardFooter className="md:self-end">
          <ActionLink>Open PCOBooster</ActionLink>
        </CardFooter>
      </Card>
    </div>
  </section>
);

const Story = () => (
  <section className="wrap pt-section">
    <figure className="reveal mx-auto grid max-w-3xl grid-cols-1 justify-items-center gap-7 text-center">
      <blockquote>
        <p className="text-quote text-balance">
          <span className="text-brand">“</span>Planning Center had everything I
          needed. I just wanted to get to it faster.
          <span className="text-brand">”</span>
        </p>
      </blockquote>
      <figcaption className="grid grid-cols-1 justify-items-center gap-4">
        <span className="flex items-center gap-3 text-left text-sm">
          <span
            aria-hidden="true"
            className="bg-brand-soft text-brand grid size-10 grid-cols-1 place-items-center rounded-full text-sm font-semibold"
          >
            JB
          </span>
          <span className="grid grid-cols-1">
            <span className="font-medium">Jake Bodea</span>
            <span className="text-muted-foreground">Creator of PCOBooster</span>
          </span>
        </span>
        <TextLink href="/about">Read why I built it</TextLink>
      </figcaption>
    </figure>
  </section>
);

const Faq = () => (
  <section className="wrap pt-section grid grid-cols-1 gap-7 md:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] md:gap-12 lg:gap-24">
    <div className="self-start md:sticky md:top-24">
      <h2 className="text-headline mb-5">FAQ</h2>
      <TextLink href={CONTACT_URL}>Ask another</TextLink>
    </div>
    <Accordion>
      {questions.map(({ question, answer }) => (
        <AccordionItem key={question} value={question}>
          <AccordionTrigger>{question}</AccordionTrigger>
          <AccordionContent>
            <p>{answer}</p>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  </section>
);

const Closing = () => (
  <section className="wrap pt-section">
    <div className="reveal bg-stage py-band relative isolate grid grid-cols-1 justify-items-center gap-7 overflow-hidden rounded-xl px-6 text-center md:rounded-3xl">
      <LoopWhenVisible className="absolute inset-0 -z-10">
        <StarField />
      </LoopWhenVisible>
      <LoopWhenVisible>
        <RocketMark motion="cruise" className="text-logo size-24 md:size-28" />
      </LoopWhenVisible>
      <h2 className="text-closing">
        Less time in tabs.
        <br />
        <em>More time with your people.</em>
      </h2>
      <ActionLink>Open PCOBooster</ActionLink>
      <p className="text-brand -mt-2 text-xs">
        Works with Planning Center Services. In beta. Not affiliated with
        Planning Center.
      </p>
    </div>
  </section>
);

const HomePage = () => (
  <main id="main">
    <script type="application/ld+json">
      {JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "PCOBooster",
        url: "https://pcobooster.com/",
      })}
    </script>
    <Hero />
    <HeroStage />
    <HowItWorks />
    <Teams />
    <People />
    <Music />
    <Extras />
    <Pricing />
    <Story />
    <Faq />
    <Closing />
  </main>
);

export const Route = createFileRoute("/")({
  head: () =>
    pageHead({
      description:
        "The workspace ministry leaders use on top of Planning Center Services: fill teams with context, look after volunteers, and get songs and chord charts ready. Every change saves back to Planning Center.",
      pathname: "/",
    }),
  component: HomePage,
});
