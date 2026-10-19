import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useFeatureEnabled } from "@/hooks/use-feature-enabled";

/**
 * A song's name that opens its song page on the arrangement given, or plain text while the
 * Songs pages are off. Every place that names a library song links through this.
 */
export const SongLink = ({
  songId,
  arrangementId,
  children,
}: {
  songId: string;
  arrangementId: string | null;
  children: ReactNode;
}): ReactNode => {
  const songsEnabled = useFeatureEnabled("chordCharts");
  if (!songsEnabled) {
    return children;
  }
  return (
    <Link
      to="/songs/$songId"
      params={{ songId }}
      search={{ arrangement: arrangementId ?? undefined }}
      className="underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
};
