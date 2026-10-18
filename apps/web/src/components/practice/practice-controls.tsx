import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import {
  keyName,
  parseKey,
} from "@pcobooster/planning-center-models/chord-chart-chords";
import type { MusicalKey } from "@pcobooster/planning-center-models/chord-chart-chords";
import {
  MAX_CAPO,
  capoKeys,
} from "@pcobooster/planning-center-models/chord-chart-lines";
import { AArrowDown, AArrowUp, ChevronDown, Paperclip } from "lucide-react";
import { Fragment } from "react";

import { PlanFileIcon } from "@/components/schedule/plan-file-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverLabel } from "@/components/ui/hover-card";
import { CHART_TEXT_SIZES } from "@/lib/practice";
import type { ChartTextSize, PracticeFiles } from "@/lib/practice";

const PITCH_CLASSES = 12;
const PLAN_KEY = "plan";

const sameKey = (left: MusicalKey | null, right: MusicalKey | null) =>
  left !== null &&
  right !== null &&
  left.pitch === right.pitch &&
  left.minor === right.minor;

interface KeyChoice {
  readonly name: string;
  readonly isPlan: boolean;
  readonly hasChart: boolean;
}

const KeyOption = ({ option }: { option: KeyChoice }) => (
  <DropdownMenuRadioItem value={option.isPlan ? PLAN_KEY : option.name}>
    {option.name}
    {option.isPlan ? (
      <span className="text-muted-foreground ml-auto text-xs">Plan key</span>
    ) : null}
  </DropdownMenuRadioItem>
);

/**
 * The key to practice in, in the song's mode. Keys Planning Center renders a chart for come
 * first; the rest show the chart as text. The plan's key is marked, and choosing it goes back
 * to following the plan.
 */
export const KeyMenu = ({
  sounding,
  planKey,
  renderedKeys,
  chosen,
  onChoose,
}: {
  sounding: MusicalKey;
  /** The key the plan sets for the song, if any. */
  planKey: string | null;
  /** Keys on the arrangement, which Planning Center renders charts for. */
  renderedKeys: readonly string[];
  /** The key chosen to practice in; undefined follows the plan. */
  chosen: string | undefined;
  onChoose: (key: string | undefined) => void;
}) => {
  const plan = parseKey(planKey);
  const rendered = renderedKeys.map(parseKey);
  const keys = Array.from({ length: PITCH_CLASSES }, (_, pitch): KeyChoice => {
    const name = keyName(pitch, sounding.minor);
    const key = parseKey(name);
    return {
      name,
      isPlan: sameKey(key, plan),
      hasChart: rendered.some((candidate) => sameKey(candidate, key)),
    };
  });
  const charted = keys.filter((key) => key.hasChart || key.isPlan);
  const others = keys.filter((key) => !(key.hasChart || key.isPlan));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={chosen === undefined ? "ghost" : "secondary"}
            size="sm"
            aria-label={`Key ${sounding.name}. Change key`}
          />
        }
      >
        Key {sounding.name}
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-52">
        <DropdownMenuRadioGroup
          value={chosen ?? PLAN_KEY}
          onValueChange={(value: string) => {
            onChoose(
              value === PLAN_KEY || value === plan?.name ? undefined : value
            );
          }}
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>Planning Center charts</DropdownMenuLabel>
            {charted.map((key) => (
              <KeyOption key={key.name} option={key} />
            ))}
          </DropdownMenuGroup>
          {others.length === 0 ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Other keys, as text</DropdownMenuLabel>
                {others.map((key) => (
                  <KeyOption key={key.name} option={key} />
                ))}
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** A capo, with the chord shapes each fret plays the song with. */
export const CapoMenu = ({
  sounding,
  capo,
  onChoose,
}: {
  /** The key heard; null when the chart's key is unknown, so shapes can't be named. */
  sounding: MusicalKey | null;
  capo: number;
  onChoose: (capo: number) => void;
}) => {
  const frets = Array.from({ length: MAX_CAPO + 1 }, (_, fret) => fret);
  const fingeredOn = (fret: number) => capoKeys(sounding, fret).fingered?.name;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={capo === 0 ? "ghost" : "secondary"}
            size="sm"
            aria-label={
              capo === 0
                ? "No capo. Add a capo"
                : `Capo ${String(capo)}. Change capo`
            }
          />
        }
      >
        {capo === 0 ? "Capo" : `Capo ${String(capo)}`}
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Capo, as text</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={String(capo)}
            onValueChange={(value: string) => {
              onChoose(Number(value));
            }}
          >
            {frets.map((fret) => {
              const fingered = fingeredOn(fret);
              return (
                <DropdownMenuRadioItem key={fret} value={String(fret)}>
                  {fret === 0 ? "No capo" : `Fret ${String(fret)}`}
                  {fret === 0 || fingered === undefined ? null : (
                    <span className="text-muted-foreground ml-auto text-xs">
                      {fingered} shapes
                    </span>
                  )}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const TextSizeControl = ({
  size,
  onStep,
}: {
  size: ChartTextSize;
  onStep: (step: 1 | -1) => void;
}) => (
  <span className="flex items-center">
    <HoverLabel
      label="Smaller text"
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Smaller text"
          disabled={size === CHART_TEXT_SIZES[0]}
          onClick={() => {
            onStep(-1);
          }}
        />
      }
    >
      <AArrowDown />
    </HoverLabel>
    <HoverLabel
      label="Larger text"
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Larger text"
          disabled={size === CHART_TEXT_SIZES.at(-1)}
          onClick={() => {
            onStep(1);
          }}
        />
      }
    >
      <AArrowUp />
    </HoverLabel>
  </span>
);

const FILE_GROUPS = [
  { key: "charts", label: "Charts" },
  { key: "videos", label: "Video" },
  { key: "other", label: "Other files" },
] as const;

/** The item's charts, lead sheets, and videos to open on the stage instead of the text chart. */
export const FilesMenu = ({
  files,
  selected,
  onChoose,
}: {
  files: PracticeFiles;
  selected: PlanFile | null;
  onChoose: (file: PlanFile) => void;
}) => {
  const groups = FILE_GROUPS.filter(({ key }) => files[key].length > 0);
  if (groups.length === 0) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={selected === null ? "ghost" : "secondary"}
            size="sm"
            className="min-w-0"
            aria-label={
              selected === null
                ? "Open a file"
                : `Showing ${selected.name}. Open another file`
            }
          />
        }
      >
        <Paperclip />
        <span className="max-w-48 truncate">
          {selected === null ? "Files" : selected.name}
        </span>
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-72">
        {groups.map(({ key, label }, index) => (
          <Fragment key={key}>
            {index === 0 ? null : <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{label}</DropdownMenuLabel>
              {files[key].map((file) => (
                <DropdownMenuItem
                  key={file.id}
                  onClick={() => {
                    onChoose(file);
                  }}
                >
                  <PlanFileIcon file={file} className="text-muted-foreground" />
                  <span className="truncate">{file.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
