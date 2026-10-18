import { failureMessage } from "@pcobooster/client/product-client";
import type { LyricsSearchResult } from "@pcobooster/contracts/http/chord-charts";
import { Search } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { LoadingBar } from "@/components/ui/loading-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { useLyricsSearch } from "@/hooks/use-chord-chart-song";

const SECONDS_PER_MINUTE = 60;
const SKELETON_ROWS = ["first", "second", "third"] as const;
const formatDuration = (seconds: number | null): string | null => {
  if (seconds === null || seconds <= 0) {
    return null;
  }
  const whole = Math.round(seconds);
  const remainder = String(whole % SECONDS_PER_MINUTE).padStart(2, "0");
  return `${Math.floor(whole / SECONDS_PER_MINUTE)}:${remainder}`;
};

const resultDetails = (result: LyricsSearchResult): string =>
  [result.artist, result.album, formatDuration(result.durationSeconds)]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");

export interface LyricsSearchPanelProps {
  /** Fills the search box; nothing is searched until the person submits. */
  initialQuery: string;
  selectedId: string | null;
  onSelect: (result: LyricsSearchResult) => void;
}

/** Finds a song's lyrics on the web (LRCLIB) so a chart can start from them. */
export const LyricsSearchPanel = ({
  initialQuery,
  selectedId,
  onSelect,
}: LyricsSearchPanelProps) => {
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState("");
  const search = useLyricsSearch(submitted);
  const results = search.data ?? [];

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(query.trim());
        }}
      >
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Song title and artist"
            placeholder="Song title and artist"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </InputGroup>
        <Button
          type="submit"
          variant="outline"
          disabled={query.trim().length < 2}
        >
          Search
        </Button>
      </form>
      <LoadingBar active={search.isFetching && results.length > 0} />
      <div
        className="flex h-56 flex-col gap-1.5 overflow-y-auto overscroll-contain"
        aria-busy={search.isFetching}
      >
        {search.isFetching && results.length === 0
          ? SKELETON_ROWS.map((row) => (
              <Skeleton key={row} variant="control" className="h-14 w-full" />
            ))
          : null}
        {submitted === "" ? (
          <p className="text-muted-foreground p-2 text-sm">
            Search to find this song’s lyrics and start the chart from them.
          </p>
        ) : null}
        {search.isError ? (
          <p className="text-muted-foreground p-2 text-sm">
            {failureMessage(
              search.error,
              "The lyrics search didn’t answer. Try again."
            )}
          </p>
        ) : null}
        {search.isSuccess && results.length === 0 ? (
          <p className="text-muted-foreground p-2 text-sm">
            No lyrics found. Try the title with a different artist, or paste
            them instead.
          </p>
        ) : null}
        {results.map((result) => (
          <Item
            key={result.id}
            render={
              <button
                type="button"
                aria-label={`${result.title}, ${resultDetails(result)}`}
              />
            }
            size="sm"
            variant={result.id === selectedId ? "muted" : "outline"}
            aria-pressed={result.id === selectedId}
            onClick={() => {
              onSelect(result);
            }}
          >
            <ItemContent>
              <ItemTitle>{result.title}</ItemTitle>
              <ItemDescription>{resultDetails(result)}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </div>
    </div>
  );
};
