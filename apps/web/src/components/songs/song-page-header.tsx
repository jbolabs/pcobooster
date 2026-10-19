import { planningCenterSongUrl } from "@pcobooster/planning-center-models/song-detail";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";

import { buttonVariants } from "@/components/ui/button-variants";
import { HoverLabel } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type SongTab = "overview" | "chart";

const isSongTab = (value: unknown): value is SongTab =>
  value === "overview" || value === "chart";

/** Switches tabs and keeps the arrangement, so the chart opens on the one being looked at. */
const SongTabs = ({
  songId,
  tab,
  arrangementId,
}: {
  songId: string;
  tab: SongTab;
  arrangementId: string | null;
}) => {
  const navigate = useNavigate();
  const search = { arrangement: arrangementId ?? undefined };
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (!isSongTab(value) || value === tab) {
          return;
        }
        void navigate(
          value === "chart"
            ? { to: "/songs/$songId/chart", params: { songId }, search }
            : { to: "/songs/$songId", params: { songId }, search }
        );
      }}
    >
      <TabsList className="h-8 max-md:h-10 max-md:w-full">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="chart">Chord chart</TabsTrigger>
      </TabsList>
    </Tabs>
  );
};

/** The song's name, writers, and tabs, shared by its Overview and Chord chart pages. */
export const SongPageHeader = ({
  songId,
  title,
  author,
  tab,
  arrangementId,
}: {
  songId: string;
  /** Null until a read names the song. */
  title: string | null;
  author: string;
  tab: SongTab;
  arrangementId: string | null;
}) => (
  <header className="flex shrink-0 flex-col gap-3">
    <div className="flex min-w-0 items-center justify-between gap-3">
      {title === null ? (
        <div className="flex min-w-0 flex-col gap-2">
          <Skeleton variant="control" className="h-6 w-56 md:h-7" />
          <Skeleton variant="text" className="h-3.5 w-40" />
        </div>
      ) : (
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight md:text-2xl">
            {title}
          </h1>
          {author === "" ? null : (
            <p className="text-muted-foreground truncate text-sm">{author}</p>
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
              className: "shrink-0 max-md:size-9 max-md:rounded-full",
            })}
          />
        }
      >
        <ExternalLink className="size-4" aria-hidden />
      </HoverLabel>
    </div>
    <SongTabs songId={songId} tab={tab} arrangementId={arrangementId} />
  </header>
);
