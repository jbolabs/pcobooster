import { createFileRoute } from "@tanstack/react-router";

import { SongPage, SongPageSkeleton } from "@/components/songs/song-page";

const SongRoute = () => {
  const { songId } = Route.useParams();
  const { arrangement } = Route.useSearch();
  return <SongPage songId={songId} arrangementId={arrangement ?? null} />;
};

export const Route = createFileRoute("/_app/songs/$songId/")({
  head: () => ({ meta: [{ title: "Song · pcobooster.com" }] }),
  pendingComponent: SongPageSkeleton,
  component: SongRoute,
});
