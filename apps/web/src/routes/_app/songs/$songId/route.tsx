import { createFileRoute } from "@tanstack/react-router";

import { featureGuard } from "@/lib/features";
import { songSearchSchema } from "@/lib/route-search";

/** A song's page and its chart share the arrangement and key in the search. */
export const Route = createFileRoute("/_app/songs/$songId")({
  validateSearch: songSearchSchema,
  ssr: "data-only",
  beforeLoad: featureGuard("chordCharts"),
});
