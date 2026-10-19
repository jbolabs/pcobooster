import { parseKey } from "@pcobooster/planning-center-models/chord-chart-chords";
import {
  MAX_CAPO,
  capoKeys,
  chartSections,
  lyricsOnly,
  readChart,
} from "@pcobooster/planning-center-models/chord-chart-lines";
import type {
  ChartLine,
  ChartSection,
} from "@pcobooster/planning-center-models/chord-chart-lines";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";

import { DemoButton, DemoPillSelect, DemoSegments } from "../ui/demo-control";
import { keysInMode, useChordChart } from "./chart-model";
import type { DemoPlanItem } from "./fixtures";
import { findSong, formatLength, usePlanItems } from "./plan-model";

import styles from "./product-demo.module.css";

const MODES = [
  { id: "chords", label: "Chords" },
  { id: "lyrics", label: "Lyrics" },
] as const;
type Mode = (typeof MODES)[number]["id"];

const TRACK_SECONDS = 252;
const TICK_MS = 1000;

/** Keys from headings, so the second `CHORUS` is `CHORUS-2`. */
const keyedSections = (sections: readonly ChartSection[]) => {
  const seen = new Map<string, number>();
  return sections.map((section) => {
    const name = section.heading ?? "opening";
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return { section, key: `${name}-${String(count)}` };
  });
};

const Line = ({ line }: { line: ChartLine }) => {
  if (line.kind === "chords") {
    return <span className={styles["chart-chord-row"]}>{line.text}</span>;
  }
  if (line.kind === "lyric") {
    return (
      <span className={styles["chart-lyric"]}>
        {line.segments.map((segment, place) => (
          // Segments have no identity but their place in the line.
          <span
            key={`segment-${String(place)}`}
            className={styles["chart-segment"]}
          >
            {line.segments.some((entry) => entry.chord !== null) ? (
              <span data-chord="">{segment.chord ?? " "}</span>
            ) : null}
            <span>{segment.text === "" ? " " : segment.text}</span>
          </span>
        ))}
      </span>
    );
  }
  if (line.kind === "comment") {
    return <em>{line.text}</em>;
  }
  return null;
};

/** The product's practice player, played against a clock instead of a recording. */
const Player = ({ title }: { title: string }) => {
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect((): (() => void) | undefined => {
    if (!playing) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      setElapsed((seconds) => (seconds + 1) % TRACK_SECONDS);
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [playing]);
  return (
    <div className={styles["practice-player"]}>
      <DemoButton
        variant="icon"
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => {
          setPlaying((value) => !value);
        }}
      >
        {playing ? (
          <Pause aria-hidden size={16} />
        ) : (
          <Play aria-hidden size={16} />
        )}
      </DemoButton>
      <span className={styles["practice-track"]}>{title} · Original mix</span>
      <span className={styles["practice-time"]}>{formatLength(elapsed)}</span>
      <progress
        className={styles["practice-progress"]}
        aria-label="Playback position"
        max={TRACK_SECONDS}
        value={elapsed}
      />
      <span className={styles["practice-time"]}>
        {formatLength(TRACK_SECONDS)}
      </span>
    </div>
  );
};

const Stage = ({ item }: { item: DemoPlanItem }) => {
  const song = findSong(item.songId);
  const chart = useChordChart(item.songId ?? "");
  const [mode, setMode] = useState<Mode>("chords");
  const [key, setKey] = useState(item.songKey ?? chart?.key ?? "C");
  const [capo, setCapo] = useState(0);
  if (song === undefined || chart === undefined || chart.chart === "") {
    return (
      <p className={styles["practice-empty"]}>
        {item.kind === "song"
          ? "This song has no chord chart yet."
          : "Nothing to practice for this item."}
      </p>
    );
  }
  const reading = readChart({
    chordChart: chart.chart,
    writtenKey: chart.key,
    soundingKey: key,
    capo,
  });
  const sections = chartSections(
    mode === "lyrics" ? lyricsOnly(reading.lines) : reading.lines
  );
  const sounding = parseKey(key);
  const frets = Array.from({ length: MAX_CAPO + 1 }, (_, fret) => fret);
  return (
    <>
      <div className={styles["practice-toolbar"]}>
        <DemoSegments
          name={`practice-mode-${item.id}`}
          options={MODES}
          value={mode}
          onValueChange={setMode}
        />
        {mode === "chords" ? (
          <>
            <DemoPillSelect
              label="Key"
              value={key}
              options={keysInMode(chart.key).map((option) => ({
                value: option,
                label: `Key ${option}`,
              }))}
              onChange={(event) => {
                setKey(event.target.value);
              }}
            />
            <DemoPillSelect
              label="Capo"
              value={String(capo)}
              options={frets.map((fret) => ({
                value: String(fret),
                label:
                  fret === 0
                    ? "No capo"
                    : `Capo ${String(fret)} · ${capoKeys(sounding, fret).fingered?.name ?? ""} shapes`,
              }))}
              onChange={(event) => {
                setCapo(Number(event.target.value));
              }}
            />
          </>
        ) : null}
      </div>
      <div className={styles["chart-columns"]}>
        {keyedSections(sections).map(({ section, key: sectionKey }) => (
          <div key={sectionKey} className={styles["chart-section"]}>
            {section.heading === null ? null : (
              <strong className={styles["practice-heading"]}>
                {section.heading}
              </strong>
            )}
            {section.lines.map((line, place) => (
              // Lines have no identity but their place in the section.
              <Line key={`line-${String(place)}`} line={line} />
            ))}
          </div>
        ))}
      </div>
      <Player title={song.title} />
    </>
  );
};

/**
 * The product's Practice view: the setlist beside the song on stage, its chart in any key or
 * with a capo, as chords or lyrics, and a player for its recordings.
 */
export const PracticeView = () => {
  const items = usePlanItems();
  const steps = items.filter((item) => item.kind === "song");
  const [currentId, setCurrentId] = useState(steps[0]?.id ?? null);
  const current = steps.find((item) => item.id === currentId) ?? steps[0];
  if (current === undefined) {
    return (
      <p className={styles["practice-empty"]}>No songs in this plan yet.</p>
    );
  }
  const position = steps.indexOf(current);
  const song = findSong(current.songId);
  const step = (offset: number) => {
    const next = steps[position + offset];
    if (next !== undefined) {
      setCurrentId(next.id);
    }
  };
  return (
    <div className={styles["practice-sheet"]}>
      <nav className={styles["practice-setlist"]} aria-label="Setlist">
        {items.map((item) =>
          item.kind === "header" ? (
            <p key={item.id} className={styles["practice-header"]}>
              {item.title}
            </p>
          ) : (
            <DemoButton
              key={item.id}
              variant="row"
              aria-current={item.id === current.id ? "true" : undefined}
              disabled={item.kind !== "song"}
              onClick={() => {
                setCurrentId(item.id);
              }}
            >
              <span>{item.title}</span>
              <span className={styles["practice-key"]}>
                {item.songKey ?? ""}
              </span>
            </DemoButton>
          )
        )}
      </nav>
      <section className={styles["practice-stage"]}>
        <header className={styles["practice-head"]}>
          <div>
            <h3>{current.title}</h3>
            <p>
              {[song?.writers, song?.arrangement, formatLength(current.seconds)]
                .filter((part) => part !== undefined && part !== "")
                .join(" · ")}
            </p>
          </div>
          <span className={styles["practice-time"]}>
            {position + 1} of {steps.length}
          </span>
          <DemoButton
            variant="stepper"
            aria-label="Previous song"
            disabled={position === 0}
            onClick={() => {
              step(-1);
            }}
          >
            <ChevronLeft aria-hidden size={16} />
          </DemoButton>
          <DemoButton
            variant="stepper"
            aria-label="Next song"
            disabled={position === steps.length - 1}
            onClick={() => {
              step(1);
            }}
          >
            <ChevronRight aria-hidden size={16} />
          </DemoButton>
        </header>
        <Stage key={current.id} item={current} />
      </section>
    </div>
  );
};
