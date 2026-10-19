import { createFileRoute } from "@tanstack/react-router";

import { featureGuard } from "@/lib/features";
import { songSearchSchema } from "@/lib/route-search";

/** A song's Overview and Chord chart tabs share its arrangement in the search. */
export const Route = createFileRoute("/_app/songs/$songId")({
  validateSearch: songSearchSchema,
  ssr: "data-only",
  beforeLoad: featureGuard("chordCharts"),
});
