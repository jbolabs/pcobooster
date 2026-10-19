import { cn } from "cn";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  Clock,
  Key,
  Lock,
} from "lucide-react";
import type { ReactNode } from "react";

import { openInDemo } from "./product-demo/demo-model";
import type { DemoView } from "./product-demo/demo-model";

/*
 * Small, static pieces of the product's interface, one per feature tile. They use the product's
 * own tokens and wording so each tile reads as a crop of the app rather than an illustration.
 */

const Snippet = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    aria-hidden="true"
    className={cn(
      "bg-card shadow-frame w-full max-w-88 rounded-xl p-3 text-sm leading-snug",
      className
    )}
  >
    {children}
  </div>
);

const Todo = () => (
  <CircleAlert className="text-status-scheduled size-3.5 shrink-0" />
);
const Done = () => (
  <span className="border-status-confirmed text-status-confirmed grid size-3.5 shrink-0 grid-cols-1 place-items-center rounded-full border">
    <Check className="size-2.5" strokeWidth={3} />
  </span>
);

const ReadinessSnippet = () => (
  <Snippet>
    <p className="mb-2 font-semibold">Readiness</p>
    {[
      { todo: true, text: "7 positions need someone" },
      { todo: true, text: "3 people haven’t responded" },
      { todo: false, text: "4 songs planned" },
      { todo: false, text: "2 service times and 1 rehearsal" },
    ].map((row) => (
      <p
        key={row.text}
        className={cn(
          "flex items-center gap-2 py-1",
          !row.todo && "text-muted-foreground"
        )}
      >
        {row.todo ? <Todo /> : <Done />}
        <span className="flex-1">{row.text}</span>
        <ChevronRight className="text-muted-foreground size-3.5 opacity-60" />
      </p>
    ))}
  </Snippet>
);

const KeyChip = ({ value }: { value: string }) => (
  <span className="border-border rounded-md border px-1.5 text-xs font-medium">
    {value}
  </span>
);

const RunSheetSnippet = () => (
  <Snippet className="p-2">
    <p className="bg-muted text-muted-foreground flex justify-between rounded-md px-2.5 py-1.5 text-xs font-semibold tracking-wide">
      <span>WORSHIP</span>
      <span className="tabular-nums">20:00</span>
    </p>
    {[
      {
        length: "5:00",
        title: "Morning Light",
        key: "G",
        note: "Radio version",
      },
      { length: "6:00", title: "Steady Ground", key: "Eb", note: "Acoustic" },
      { length: "5:00", title: "Open Doors", key: "E", note: "2w ago" },
    ].map((row) => (
      <p
        key={row.title}
        className="border-border flex items-center gap-3 border-b px-2.5 py-2 last:border-0"
      >
        <span className="text-muted-foreground w-8 text-xs tabular-nums">
          {row.length}
        </span>
        <span className="font-medium whitespace-nowrap">{row.title}</span>
        <KeyChip value={row.key} />
        <span className="text-muted-foreground truncate text-xs">
          {row.note}
        </span>
      </p>
    ))}
  </Snippet>
);

const KeyTransitionSnippet = () => (
  <Snippet>
    <p className="flex items-center gap-2">
      <KeyChip value="G" />
      <ArrowRight className="text-muted-foreground size-3.5" />
      <Key className="text-status-scheduled size-3.5" />
      <ArrowRight className="text-muted-foreground size-3.5" />
      <KeyChip value="Eb" />
      <span className="text-muted-foreground ml-auto text-xs">
        Down a major third
      </span>
    </p>
    <p className="text-muted-foreground mt-3 mb-1 text-xs font-medium">
      Ideas to connect
    </p>
    {["Set up the new key", "Reset under a prayer", "Swap the order"].map(
      (idea) => (
        <p key={idea} className="flex items-center gap-2 py-0.5">
          <span className="bg-brand size-1 rounded-full" />
          {idea}
        </p>
      )
    )}
  </Snippet>
);

const TimesSnippet = () => (
  <Snippet>
    <p className="bg-muted flex items-center gap-2 rounded-full px-3 py-1.5 font-medium">
      <Clock className="size-3.5" />
      Sun, Oct 11 · 9:00 AM
    </p>
    <p className="border-border mt-2.5 grid grid-cols-3 rounded-lg border p-0.5 text-center text-xs">
      <span className="text-muted-foreground py-1">Rehearsal</span>
      <span className="bg-background border-border rounded-md border py-1 font-medium">
        Service
      </span>
      <span className="text-muted-foreground py-1">Other</span>
    </p>
    <p className="bg-muted text-muted-foreground mt-2.5 rounded-full px-3 py-1.5 text-xs">
      4 teams, 11 positions, 9 people
    </p>
  </Snippet>
);

const StatusDot = ({ className }: { className: string }) => (
  <span className={cn("size-2 shrink-0 rounded-full", className)} />
);

const ResponsesSnippet = () => (
  <Snippet className="p-1.5">
    {[
      { label: "Confirmed", dot: "bg-status-confirmed", current: true },
      { label: "Pending", dot: "bg-status-scheduled", current: false },
      { label: "Declined", dot: "bg-status-declined", current: false },
    ].map((row) => (
      <p
        key={row.label}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5",
          row.current && "bg-accent"
        )}
      >
        <StatusDot className={row.dot} />
        <span className="flex-1">{row.label}</span>
        {row.current ? <Check className="size-3.5" /> : null}
      </p>
    ))}
    <span className="bg-border my-1 block h-px" />
    <p className="px-2 py-1.5">Schedule someone else</p>
    <p className="text-destructive px-2 py-1.5">Remove</p>
  </Snippet>
);

const UnsentSnippet = () => (
  <Snippet>
    {[
      { initials: "LP", name: "Lane Parker", role: "Drums" },
      { initials: "EL", name: "Eden Lane", role: "Lyrics" },
    ].map((row) => (
      <p key={row.name} className="flex items-center gap-2.5 py-1">
        <span className="bg-muted text-muted-foreground grid size-7 grid-cols-1 place-items-center rounded-full text-xs font-medium">
          {row.initials}
        </span>
        <span className="grid flex-1 grid-cols-1">
          <span className="font-medium">{row.name}</span>
          <span className="text-muted-foreground text-xs">{row.role}</span>
        </span>
        <span className="text-status-scheduled text-xs">Not notified yet</span>
      </p>
    ))}
    <p className="border-border mt-2 flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-medium">
      Send the email in Planning Center
      <ArrowUpRight className="size-3" />
    </p>
  </Snippet>
);

const PermissionsSnippet = () => (
  <Snippet>
    <p className="text-muted-foreground mb-1.5 text-xs font-medium">
      Your access in Services
    </p>
    {[
      { team: "Worship", level: "Editor", locked: false },
      { team: "Production", level: "Scheduler", locked: false },
      { team: "Kids", level: "Viewer", locked: true },
    ].map((row) => (
      <p key={row.team} className="flex items-center gap-2 py-1">
        <span className="flex-1">{row.team}</span>
        <span className="text-muted-foreground text-xs">{row.level}</span>
        {row.locked ? (
          <Lock className="text-muted-foreground size-3.5" />
        ) : (
          <Check className="text-status-confirmed size-3.5" />
        )}
      </p>
    ))}
  </Snippet>
);

const Line = ({ className }: { className: string }) => (
  <span className={cn("block h-1.5 rounded-full", className)} />
);

/** A tablet and a phone showing the plan's readiness, as wireframes in the product's colors. */
const DevicesSnippet = () => (
  <div aria-hidden="true" className="flex items-end gap-4">
    <div className="bg-card shadow-frame border-primary flex h-36 w-52 gap-2 rounded-2xl border-4 p-2">
      <div className="bg-muted grid w-10 grid-cols-1 content-start gap-1.5 rounded-md p-1.5">
        <Line className="bg-foreground/30 w-6" />
        <Line className="bg-foreground/15 w-5" />
        <Line className="bg-foreground/15 w-6" />
        <Line className="bg-foreground/15 w-4" />
      </div>
      <div className="grid flex-1 grid-cols-1 content-start gap-1.5 pt-1">
        <Line className="bg-foreground/40 w-20" />
        <div className="border-border mt-1 grid grid-cols-1 gap-1.5 rounded-md border p-1.5">
          <span className="flex items-center gap-1">
            <span className="bg-status-scheduled size-1.5 rounded-full" />
            <Line className="bg-foreground/20 w-16" />
          </span>
          <span className="flex items-center gap-1">
            <span className="bg-status-scheduled size-1.5 rounded-full" />
            <Line className="bg-foreground/20 w-12" />
          </span>
          <span className="flex items-center gap-1">
            <span className="bg-status-confirmed size-1.5 rounded-full" />
            <Line className="bg-foreground/15 w-14" />
          </span>
        </div>
        <span className="bg-muted mt-1 flex h-1.5 overflow-hidden rounded-full">
          <span className="bg-status-confirmed w-1/2" />
          <span className="bg-status-scheduled w-1/6" />
        </span>
      </div>
    </div>
    <div className="bg-card shadow-frame border-primary flex h-32 w-16 flex-col gap-1.5 rounded-xl border-4 p-1.5">
      <Line className="bg-foreground/40 w-8" />
      <span className="flex items-center gap-1">
        <span className="bg-status-scheduled size-1.5 shrink-0 rounded-full" />
        <Line className="bg-foreground/20 w-6" />
      </span>
      <span className="flex items-center gap-1">
        <span className="bg-status-confirmed size-1.5 shrink-0 rounded-full" />
        <Line className="bg-foreground/15 w-7" />
      </span>
      <span className="border-border mt-auto flex justify-between border-t pt-1">
        <span className="bg-foreground/40 size-1.5 rounded-full" />
        <span className="bg-foreground/15 size-1.5 rounded-full" />
        <span className="bg-foreground/15 size-1.5 rounded-full" />
      </span>
    </div>
  </div>
);

interface Tile {
  readonly title: string;
  readonly description: string;
  readonly snippet: ReactNode;
  /** The replica view that shows it; the whole tile opens it. */
  readonly view?: DemoView;
  readonly badge?: string;
  readonly wide?: boolean;
}

const tiles: readonly Tile[] = [
  {
    title: "Readiness at a glance",
    description:
      "Open positions, unanswered requests, songs without a key, and missing times in one checklist for the plan.",
    snippet: <ReadinessSnippet />,
    view: "overview",
    wide: true,
  },
  {
    title: "A run sheet you can edit",
    description:
      "Headers, items, songs, keys, and lengths in order, with the running time of each section.",
    snippet: <RunSheetSnippet />,
    view: "plan",
    wide: true,
  },
  {
    title: "Key transitions",
    description:
      "See how each song lands in the next one’s key, with ideas when the change is rough.",
    snippet: <KeyTransitionSnippet />,
    view: "plan",
  },
  {
    title: "Service and rehearsal times",
    description:
      "Add and adjust times without leaving the plan, and see who each one involves.",
    snippet: <TimesSnippet />,
    view: "times",
  },
  {
    title: "Responses and swaps",
    description:
      "Mark who accepted, remove someone, or schedule someone else right from the lineup.",
    snippet: <ResponsesSnippet />,
    view: "lineup",
  },
  {
    title: "Unsent requests flagged",
    description:
      "Spot who hasn’t been notified yet, then send the email from Planning Center in one step.",
    snippet: <UnsentSnippet />,
  },
  {
    title: "Your permissions, respected",
    description:
      "PCOBooster works inside the access each person already has in Planning Center.",
    snippet: <PermissionsSnippet />,
  },
  {
    title: "Phone and tablet apps",
    description:
      "Native apps for the change that comes up on Sunday morning, from the stage or the sound booth.",
    snippet: <DevicesSnippet />,
    badge: "Coming soon",
  },
];

const TileBody = ({ tile }: { tile: Tile }) => (
  <>
    <div className="bg-stage flex h-56 items-center justify-center overflow-hidden rounded-2xl px-5">
      {tile.snippet}
    </div>
    <div className="px-2 pt-5 pb-2">
      <h3 className="flex items-center gap-2.5 text-base font-medium tracking-tight">
        {tile.title}
        {tile.badge === undefined ? null : (
          <span className="bg-brand-soft text-brand rounded-full px-2 py-0.5 text-xs font-medium">
            {tile.badge}
          </span>
        )}
        {tile.view === undefined ? null : (
          <ArrowRight
            aria-hidden="true"
            className="text-brand ml-auto size-4 shrink-0"
          />
        )}
      </h3>
      <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
        {tile.description}
      </p>
    </div>
  </>
);

const tileClass =
  "bg-card shadow-frame flex h-full w-full flex-col rounded-3xl p-2 text-left";

/** The smaller jobs of a planning week as a bento grid; tiles with a view open it in the demo. */
export const FeatureTiles = ({ demoAnchorId }: { demoAnchorId: string }) => (
  <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
    {tiles.map((tile) => (
      <li
        key={tile.title}
        className={cn(
          "reveal flex",
          tile.wide === true ? "lg:col-span-3" : "lg:col-span-2"
        )}
      >
        {tile.view === undefined ? (
          <div className={tileClass}>
            <TileBody tile={tile} />
          </div>
        ) : (
          <a
            href={`#${demoAnchorId}`}
            aria-label={`${tile.title}: see it in the demo`}
            className={cn(tileClass, "cursor-pointer")}
            onClick={(event) => {
              event.preventDefault();
              if (tile.view !== undefined) {
                openInDemo(tile.view, demoAnchorId);
              }
            }}
          >
            <TileBody tile={tile} />
          </a>
        )}
      </li>
    ))}
  </ul>
);
