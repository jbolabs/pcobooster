import { planningCenterSongUrl } from "@pcobooster/planning-center-models/song-detail";
import { ExternalLink } from "lucide-react";

import { buttonVariants } from "@/components/ui/button-variants";
import { HoverLabel } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";

export const SongPageHeaderSkeleton = () => (
  <div className="flex min-w-0 flex-col gap-2">
    <Skeleton variant="control" className="h-6 w-56 md:h-7" />
    <Skeleton variant="text" className="h-3.5 w-64 max-w-full" />
  </div>
);

/** The song's name and credits, with Planning Center one click away. */
export const SongPageHeader = ({
  songId,
  title,
  credits,
}: {
  songId: string;
  /** Null until a read names the song. */
  title: string | null;
  /** Writers, "CCLI 6605236", and the copyright; each shown whole, wrapping as needed. */
  credits: readonly string[];
}) => (
  <header className="flex min-w-0 shrink-0 items-start justify-between gap-3">
    {title === null ? (
      <SongPageHeaderSkeleton />
    ) : (
      <div className="min-w-0">
        <h1 className="line-clamp-2 text-xl font-semibold tracking-tight wrap-break-word md:text-2xl">
          {title}
        </h1>
        {credits.length === 0 ? null : (
          <p className="text-muted-foreground text-sm wrap-break-word">
            {credits.map((part, index) => (
              // `songCreditParts` drops repeats, so each part's text is its key.
              <span key={part}>
                {index > 0 ? " · " : null}
                {/* Writers and copyright wrap; a CCLI number stays whole. */}
                <span
                  className={
                    part.startsWith("CCLI ") ? "whitespace-nowrap" : undefined
                  }
                >
                  {part}
                </span>
              </span>
            ))}
          </p>
        )}
      </div>
    )}
    <HoverLabel
      label="Open in Planning Center"
      side="bottom"
      align="end"
      sideOffset={8}
      render={
        <a
          href={planningCenterSongUrl(songId)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open in Planning Center"
          className={buttonVariants({
            variant: "outline",
            size: "icon-sm",
            touch: "target",
            className: "shrink-0 max-md:rounded-full",
          })}
        />
      }
    >
      <ExternalLink className="size-4" aria-hidden />
    </HoverLabel>
  </header>
);
