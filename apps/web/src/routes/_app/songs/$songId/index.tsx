import { createFileRoute } from "@tanstack/react-router";

import { SongPage, SongPageSkeleton } from "@/components/songs/song-page";

const SongRoute = () => {
  const { songId } = Route.useParams();
  const search = Route.useSearch();
  return <SongPage songId={songId} search={search} />;
};

export const Route = createFileRoute("/_app/songs/$songId/")({
  head: () => ({ meta: [{ title: "Song · pcobooster.com" }] }),
  pendingComponent: SongPageSkeleton,
  component: SongRoute,
});
