import { failureMessage } from "@pcobooster/client/product-client";
import { NotFound } from "@pcobooster/contracts/faults/not-found";
import type { ChordChartArrangement } from "@pcobooster/contracts/http/chord-charts";
import type { ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useChordChartPdf } from "@/hooks/use-chord-chart-song";
import { renderPdfPages } from "@/lib/pdf-pages";

const observeWidth = (
  element: HTMLElement,
  onWidth: (width: number) => void
): (() => void) => {
  const observer = new ResizeObserver(([entry]) => {
    onWidth(Math.floor(entry?.contentRect.width ?? 0));
  });
  observer.observe(element);
  return () => {
    observer.disconnect();
  };
};

/** Draws the PDF into `pages` unless a newer render starts first; returns the cancel. */
const drawPages = (
  pages: HTMLElement,
  data: string,
  width: number,
  callbacks: { onDrawn: () => void; onFailed: () => void }
): (() => void) => {
  let current = true;
  const draw = async () => {
    try {
      const canvases = await renderPdfPages(data, width);
      if (current) {
        pages.replaceChildren(...canvases);
        callbacks.onDrawn();
      }
    } catch {
      if (current) {
        callbacks.onFailed();
      }
    }
  };
  void draw();
  return () => {
    current = false;
  };
};

/**
 * Pages drawn into `pagesRef`, and which chart (`source`) they show. A new render of the same
 * chart replaces the old pages only once it is ready, so the editor's preview never blanks and
 * keeps its scroll position.
 */
const usePdfPages = (data: string | undefined, source: string) => {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drawnSource, setDrawnSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const pages = pagesRef.current;
    return pages ? observeWidth(pages, setWidth) : undefined;
  }, []);

  useEffect(() => {
    const pages = pagesRef.current;
    return data === undefined || pages === null || width === 0
      ? undefined
      : drawPages(pages, data, width, {
          onDrawn: () => {
            setDrawnSource(source);
            setFailed(false);
          },
          onFailed: () => {
            setFailed(true);
          },
        });
  }, [data, width, source]);

  return { pagesRef, drawnSource, failed };
};

export interface PlanningCenterPdf {
  /** The pages on screen are this chart's (this arrangement and key). */
  readonly drawn: boolean;
  readonly failed: boolean;
  /** Planning Center is rendering, or the pages are being drawn. */
  readonly rendering: boolean;
  /** Planning Center has no chart for this key yet. */
  readonly missing: boolean;
  /** Why the chart didn't load, or null. */
  readonly error: string | null;
  readonly handleRetry: () => void;
}

export interface PlanningCenterPdfRead {
  /** Where the pages are drawn; pass it to `PlanningCenterPdfPages`. */
  readonly pagesRef: RefObject<HTMLDivElement | null>;
  readonly pdf: PlanningCenterPdf;
}

/**
 * The chart exactly as Planning Center renders it: Services' own PDF of the saved chart, for
 * one of the arrangement's keys or (with `keyId` null) its lyrics sheet. Another key's pages
 * never stand in while this key's load, so nobody reads the wrong key.
 */
export const usePlanningCenterPdf = ({
  songId,
  arrangement,
  keyId,
}: {
  songId: string;
  arrangement: ChordChartArrangement;
  keyId: string | null;
}): PlanningCenterPdfRead => {
  const pdf = useChordChartPdf({
    songId,
    arrangementId: arrangement.id,
    keyId,
    updatedAt: arrangement.updatedAt,
  });
  const source = `${arrangement.id}:${keyId ?? "lyrics"}`;
  // The chart the last real answer was for; a placeholder from another chart isn't drawn.
  const [answeredSource, setAnsweredSource] = useState<string | null>(null);
  if (
    pdf.data !== undefined &&
    !pdf.isPlaceholderData &&
    answeredSource !== source
  ) {
    setAnsweredSource(source);
  }
  const foreign = pdf.isPlaceholderData && answeredSource !== source;
  const { pagesRef, drawnSource, failed } = usePdfPages(
    foreign ? undefined : pdf.data?.data,
    source
  );
  const drawn = drawnSource === source;
  const missing = pdf.error instanceof NotFound;
  return {
    pagesRef,
    pdf: {
      drawn,
      failed,
      rendering: pdf.isFetching || (pdf.data !== undefined && !drawn),
      missing,
      error:
        pdf.error === null || missing
          ? null
          : failureMessage(pdf.error, "Planning Center’s chart didn’t load."),
      handleRetry: () => {
        void pdf.refetch();
      },
    },
  };
};

/**
 * The PDF's pages, with a letter-shaped placeholder until they are drawn. A chart Planning
 * Center hasn't rendered says so in one line (`missing`), with `missingAction` beside it.
 */
export const PlanningCenterPdfPages = ({
  pdf,
  pagesRef,
  missingLabel,
  missingAction,
}: {
  pdf: PlanningCenterPdf;
  pagesRef: RefObject<HTMLDivElement | null>;
  missingLabel: string;
  missingAction?: ReactNode;
}) => {
  const settled = pdf.missing || pdf.error !== null;
  return (
    <>
      {pdf.missing ? (
        <div className="flex flex-wrap items-center gap-3 py-2">
          <p className="text-muted-foreground text-sm">{missingLabel}</p>
          {missingAction}
        </div>
      ) : null}
      {pdf.error === null ? null : (
        <div className="flex flex-wrap items-center gap-3 py-2">
          <p className="text-muted-foreground text-sm">{pdf.error}</p>
          <Button variant="outline" size="xs" onClick={pdf.handleRetry}>
            Retry
          </Button>
        </div>
      )}
      {pdf.failed ? (
        <p className="text-muted-foreground py-2 text-sm">
          The PDF from Planning Center could not be drawn.
        </p>
      ) : null}
      {pdf.drawn || settled ? null : (
        <Skeleton variant="control" className="aspect-[8.5/11] w-full" />
      )}
      <div
        ref={pagesRef}
        aria-label="Chord chart from Planning Center"
        aria-hidden={!pdf.drawn || settled}
        // Until this chart's pages are drawn, another key's may still be here: they stay out
        // of sight, keeping the width the next pages are drawn at.
        className={
          pdf.drawn && !settled
            ? "flex flex-col gap-4"
            : "invisible flex h-0 flex-col gap-4 overflow-hidden"
        }
      />
    </>
  );
};
