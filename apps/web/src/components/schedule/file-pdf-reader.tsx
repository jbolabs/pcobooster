import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { loadPdfDocument, PDF_PAGE_DARK_CLASS } from "@/lib/pdf-pages";
import { cn } from "@/lib/utils";

export const FilePdfReader = ({ data }: { data: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect((): (() => void) | undefined => {
    const element = container.current;
    if (element === null) {
      return undefined;
    }
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry?.contentRect.width ?? 0));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    let current = true;
    let task: Awaited<ReturnType<typeof loadPdfDocument>> | null = null;
    const load = async () => {
      try {
        const loading = await loadPdfDocument(data);
        task = loading;
        if (!current) {
          await loading.destroy();
          return;
        }
        const loaded = await loading.promise;
        if (current) {
          setDocument(loaded);
        }
      } catch {
        if (current) {
          setState("error");
        }
      }
    };
    void load();
    return () => {
      current = false;
      void task?.destroy();
    };
  }, [data]);
  useEffect((): (() => void) | undefined => {
    if (document === null || width === 0) {
      return undefined;
    }
    let current = true;
    let rendering: ReturnType<
      Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]
    > | null = null;
    const draw = async () => {
      try {
        const pdfPage = await document.getPage(page);
        const cssWidth = Math.min(width, 1000) * zoom;
        const scale = cssWidth / pdfPage.getViewport({ scale: 1 }).width;
        const viewport = pdfPage.getViewport({
          scale: scale * Math.min(window.devicePixelRatio || 1, 2),
        });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        if (!current) {
          return;
        }
        rendering = pdfPage.render({ canvas, viewport });
        await rendering.promise;
        if (current) {
          const visible = canvasRef.current;
          if (visible !== null) {
            visible.width = canvas.width;
            visible.height = canvas.height;
            visible.getContext("2d")?.drawImage(canvas, 0, 0);
          }
          setState("ready");
        }
      } catch {
        if (current) {
          setState("error");
        }
      }
    };
    void draw();
    return () => {
      current = false;
      rendering?.cancel();
    };
  }, [document, page, width, zoom]);
  const pageStyle: CSSProperties & { "--pdf-width": string } = {
    "--pdf-width": `${String(Math.min(width, 1000) * zoom)}px`,
  };
  const pageCount = document?.numPages ?? null;
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Sized by its pane alone (contain-inline-size): a zoomed page scrolls here instead of
          widening every pane around it, which would re-center the controls and feed its
          own width back into the measurement. */}
      <div
        ref={container}
        className="min-h-0 flex-1 overflow-auto overscroll-contain px-3 pb-16 contain-inline-size sm:px-6"
      >
        {state === "loading" ? (
          <div className="text-muted-foreground flex justify-center gap-2 py-12 text-sm">
            <Spinner aria-label="Rendering PDF" /> Rendering…
          </div>
        ) : null}
        {state === "error" ? (
          <p role="alert" className="py-12 text-center text-sm">
            This PDF couldn’t be rendered. Try refreshing the file link.
          </p>
        ) : null}
        <canvas
          ref={canvasRef}
          aria-label={`PDF page ${String(page)}`}
          className={cn(
            "mx-auto block h-auto w-(--pdf-width) bg-white",
            PDF_PAGE_DARK_CLASS,
            state !== "ready" && "hidden"
          )}
          style={pageStyle}
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] flex justify-center px-3">
        <div className="bg-popover pointer-events-auto flex items-center gap-0.5 rounded-full border p-1 shadow-lg">
          {pageCount !== null && pageCount > 1 ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous page"
                disabled={page === 1}
                onClick={() => {
                  setPage((value) => value - 1);
                }}
              >
                <ChevronLeft />
              </Button>
              <span className="min-w-14 text-center text-xs tabular-nums">
                {page} / {pageCount}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next page"
                disabled={page >= pageCount}
                onClick={() => {
                  setPage((value) => value + 1);
                }}
              >
                <ChevronRight />
              </Button>
              <span className="bg-border mx-1 h-5 w-px" aria-hidden />
            </>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            disabled={zoom <= 1}
            onClick={() => {
              setZoom((value) => Math.max(1, value - 0.25));
            }}
          >
            <Minus />
          </Button>
          <span className="min-w-10 text-center text-xs tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            disabled={zoom >= 2}
            onClick={() => {
              setZoom((value) => Math.min(2, value + 0.25));
            }}
          >
            <Plus />
          </Button>
        </div>
      </div>
    </div>
  );
};
