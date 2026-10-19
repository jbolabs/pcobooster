import { failureMessage } from "@pcobooster/client/product-client";
import { Link } from "@tanstack/react-router";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { chordChartLoadFailure } from "@/hooks/use-chord-chart-song";

export const BackToSongs = () => (
  <Button variant="outline" nativeButton={false} render={<Link to="/songs" />}>
    Back to Songs
  </Button>
);

/** Says why a song didn't open, and offers what would help. */
export const SongLoadError = ({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) => {
  const failure = chordChartLoadFailure(error);
  let title = "This song didn’t load";
  let description = "Planning Center didn’t answer. Try again in a moment.";
  if (failure === "not-found") {
    title = "Song not found";
    description =
      "Planning Center has no song at this link. It may have been deleted, or it belongs to another organization.";
  } else if (failure === "no-access") {
    title = "You can’t open this song";
    description = failureMessage(
      error,
      "Your Planning Center account can’t view songs in Services."
    );
  }
  return (
    <PageShell layout="center">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap justify-center gap-2">
            {failure === "failed" ? (
              <Button onClick={onRetry}>Try again</Button>
            ) : null}
            <BackToSongs />
          </div>
        </EmptyContent>
      </Empty>
    </PageShell>
  );
};
