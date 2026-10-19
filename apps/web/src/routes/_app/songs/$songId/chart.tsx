import { createFileRoute } from "@tanstack/react-router";

import {
  ChordChartEditorPage,
  ChordChartEditorPageSkeleton,
} from "@/components/songs/chord-chart-editor-page";

const SongChartRoute = () => {
  const { songId } = Route.useParams();
  const { arrangement } = Route.useSearch();
  return (
    <ChordChartEditorPage songId={songId} arrangementId={arrangement ?? null} />
  );
};

export const Route = createFileRoute("/_app/songs/$songId/chart")({
  head: () => ({ meta: [{ title: "Chord chart · pcobooster.com" }] }),
  pendingComponent: ChordChartEditorPageSkeleton,
  component: SongChartRoute,
});
