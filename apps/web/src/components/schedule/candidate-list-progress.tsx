import type { CandidateListProgress as Progress } from "@pcobooster/planning-center-models/candidate-list";

import { Button } from "@/components/ui/button";
import { HoverLabel } from "@/components/ui/hover-card";
import { LoadingBar } from "@/components/ui/loading-bar";

interface CandidateListProgressProps {
  progress: Progress | undefined;
  isFetching: boolean;
  isEnriching: boolean;
  failedPartCount: number;
  onRetry: () => void;
}

const describeProgress = ({
  candidateCount,
  detailedCount,
  historyLoaded,
}: Progress): string => {
  const history = historyLoaded ? "Serving history loaded" : "Loading history";
  const people = candidateCount === 1 ? "person" : "people";
  return `${history}; availability for ${detailedCount} of ${candidateCount} ${people}.`;
};

/**
 * The candidate list's loading line. While history and availability arrive it is only the thin
 * loading bar, so the list never shifts; hovering the bar shows how much has loaded. A failed part
 * is the one case worth interrupting for, so it adds a visible Retry row.
 */
export const CandidateListProgress = ({
  progress,
  isFetching,
  isEnriching,
  failedPartCount,
  onRetry,
}: CandidateListProgressProps) => {
  const loading = isFetching || isEnriching;
  const description =
    progress !== undefined && isEnriching ? describeProgress(progress) : null;
  return (
    <>
      <div className="relative -my-1 shrink-0">
        <LoadingBar active={loading} />
        {description === null ? null : (
          <HoverLabel
            label={description}
            side="bottom"
            align="start"
            trigger={
              <div className="absolute inset-x-0 -inset-y-1.5 cursor-default" />
            }
          />
        )}
        <span className="sr-only" aria-live="polite">
          {description ?? ""}
        </span>
      </div>
      {failedPartCount > 0 ? (
        <div className="text-muted-foreground flex shrink-0 items-center gap-3 text-xs">
          <span className="text-destructive">
            Some history or availability failed to load.
          </span>
          <Button variant="outline" size="xs" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
    </>
  );
};
