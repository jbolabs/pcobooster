import { createFileRoute } from "@tanstack/react-router";

import {
  ChordChartEditorPage,
  ChordChartEditorPageSkeleton,
} from "@/components/songs/chord-chart-editor-page";

const SongChartRoute = () => {
  const { songId } = Route.useParams();
  const search = Route.useSearch();
  return <ChordChartEditorPage songId={songId} search={search} />;
};

export const Route = createFileRoute("/_app/songs/$songId/chart")({
  head: () => ({ meta: [{ title: "Chart · pcobooster.com" }] }),
  pendingComponent: ChordChartEditorPageSkeleton,
  component: SongChartRoute,
});
