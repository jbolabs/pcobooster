import { getInitials } from "@pcobooster/planning-center-models/initials";
import { CalendarPlus, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Item } from "@/components/ui/item";
import { LoadingBar } from "@/components/ui/loading-bar";
import {
  ResponsivePopover,
  ResponsivePopoverContent,
  ResponsivePopoverTrigger,
} from "@/components/ui/responsive-popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { usePeopleSearch } from "@/hooks/use-people-search";
import type { PeopleSearchResult } from "@/hooks/use-people-search";
import { useSchedulePlanPerson } from "@/hooks/use-schedule-plan-person";
import { ReplayMask } from "@/lib/replay-mask";

interface SomeoneElseRowProps {
  serviceTypeId?: string | null;
  planId?: string | null;
  teamId?: string | null;
  positionId?: string | null;
  teamName?: string | null;
  positionName?: string | null;
  onScheduleSuccess?: () => void;
  onScheduleError?: (message: string) => void;
}

const PEOPLE_SEARCH_DEBOUNCE_MS = 150;

const SomeoneElseResultRow = ({
  person,
  serviceTypeId,
  planId,
  teamId,
  positionId,
  teamName,
  positionName,
  canSchedule,
  onScheduleSuccess,
  onOptimisticSchedule,
  onScheduleError,
}: {
  person: PeopleSearchResult;
  serviceTypeId?: string | null;
  planId?: string | null;
  teamId?: string | null;
  positionId?: string | null;
  teamName?: string | null;
  positionName?: string | null;
  canSchedule: boolean;
  onScheduleSuccess?: () => void;
  onOptimisticSchedule?: () => void;
  onScheduleError?: (message: string) => void;
}) => {
  const { isScheduling, handleSchedule } = useSchedulePlanPerson({
    serviceTypeId,
    planId,
    teamId,
    positionId,
    teamName,
    positionName,
    canSchedule,
    onOptimisticSchedule,
    onScheduleSuccess,
    onScheduleError,
    oneOff: true,
  });
  const initials = getInitials(person.fullName);

  return (
    <CommandItem
      value={`${person.fullName} ${person.id}`}
      onSelect={() => {
        handleSchedule(person);
      }}
      disabled={!canSchedule || isScheduling}
    >
      <Avatar className="size-8 shrink-0">
        <AvatarImage src={person.photoThumbnailUrl ?? undefined} alt="" />
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <p className="min-w-0 flex-1 truncate text-sm font-medium">
        <ReplayMask>{person.fullName}</ReplayMask>
      </p>
      {isScheduling ? (
        <Spinner className="size-3.5" aria-hidden />
      ) : (
        <CalendarPlus className="size-3.5 opacity-70" aria-hidden />
      )}
    </CommandItem>
  );
};

const SomeoneElseSearchContent = ({
  inputRef,
  query,
  onQueryChange,
  showPrompt,
  showLoading,
  showRefreshing,
  isError,
  results,
  serviceTypeId,
  planId,
  teamId,
  positionId,
  teamName,
  positionName,
  canSchedule,
  onScheduleSuccess,
  onOptimisticSchedule,
  onScheduleError,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
  showPrompt: boolean;
  showLoading: boolean;
  showRefreshing: boolean;
  isError: boolean;
  results: PeopleSearchResult[];
  serviceTypeId?: string | null;
  planId?: string | null;
  teamId?: string | null;
  positionId?: string | null;
  teamName?: string | null;
  positionName?: string | null;
  canSchedule: boolean;
  onScheduleSuccess?: () => void;
  onOptimisticSchedule?: () => void;
  onScheduleError?: (message: string) => void;
}) => {
  let searchContent: React.ReactNode;
  if (showPrompt) {
    searchContent = (
      <p className="text-muted-foreground px-3 py-2.5 text-sm">
        Type at least 2 characters.
      </p>
    );
  } else if (showLoading) {
    searchContent = (
      <div
        className="flex flex-col p-1"
        aria-busy
        aria-label="Searching people"
      >
        {["8rem", "6rem", "9rem"].map((width) => (
          <div key={width} className="flex items-center gap-2.5 px-2 py-1.5">
            <Skeleton variant="round" className="size-6 shrink-0" />
            <Skeleton variant="text" className="h-3.5" width={width} />
          </div>
        ))}
      </div>
    );
  } else if (isError) {
    searchContent = (
      <p className="text-destructive px-3 py-2.5 text-sm">Search failed.</p>
    );
  } else if (results.length === 0) {
    searchContent = <CommandEmpty>No people found.</CommandEmpty>;
  } else {
    searchContent = (
      <CommandGroup>
        {results.map((person) => (
          <SomeoneElseResultRow
            key={person.id}
            person={person}
            serviceTypeId={serviceTypeId}
            planId={planId}
            teamId={teamId}
            positionId={positionId}
            teamName={teamName}
            positionName={positionName}
            canSchedule={canSchedule}
            onScheduleSuccess={onScheduleSuccess}
            onOptimisticSchedule={onOptimisticSchedule}
            onScheduleError={onScheduleError}
          />
        ))}
      </CommandGroup>
    );
  }

  return (
    <Command shouldFilter={false}>
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={onQueryChange}
        placeholder="Search people"
      />
      <LoadingBar active={showRefreshing} className="-mt-0.5" />
      <CommandList className="max-h-72">{searchContent}</CommandList>
    </Command>
  );
};

export const SomeoneElseRow = ({
  serviceTypeId,
  planId,
  teamId,
  positionId,
  teamName,
  positionName,
  onScheduleSuccess,
  onScheduleError,
}: SomeoneElseRowProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, PEOPLE_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [query]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const search = usePeopleSearch(debouncedQuery);
  const canSchedule =
    serviceTypeId !== null &&
    serviceTypeId !== undefined &&
    serviceTypeId !== "" &&
    planId !== null &&
    planId !== undefined &&
    planId !== "" &&
    teamId !== null &&
    teamId !== undefined &&
    teamId !== "" &&
    positionId !== null &&
    positionId !== undefined &&
    positionId !== "";
  const searchResults = search.data ?? [];
  const normalizedQuery = query.trim();
  const normalizedDebouncedQuery = debouncedQuery.trim();
  const searchHasQuery = normalizedQuery.length >= 2;
  const searchInputPending =
    searchHasQuery && normalizedDebouncedQuery !== normalizedQuery;
  const showInitialSearchLoading =
    searchHasQuery &&
    (searchInputPending || (search.isLoading && searchResults.length === 0));
  const showSearchRefreshing =
    searchHasQuery &&
    !searchInputPending &&
    search.isFetching &&
    searchResults.length > 0;

  const closeSearch = () => {
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
  };

  const handleSuccess = () => {
    onScheduleSuccess?.();
  };

  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger
        render={
          <Item
            size="sm"
            render={<button type="button" aria-label="Schedule someone else" />}
          />
        }
      >
        <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full sm:size-9">
          <UserPlus className="size-4" aria-hidden />
        </span>
        <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium sm:text-base">
          Someone else...
        </span>
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent
        title="Schedule someone else"
        align="start"
        side="bottom"
        sideOffset={8}
        className="w-[min(24rem,calc(100vw-2rem))]"
      >
        <SomeoneElseSearchContent
          inputRef={inputRef}
          query={query}
          onQueryChange={setQuery}
          showPrompt={!searchHasQuery}
          showLoading={showInitialSearchLoading}
          showRefreshing={showSearchRefreshing}
          isError={search.isError}
          results={searchResults}
          serviceTypeId={serviceTypeId}
          planId={planId}
          teamId={teamId}
          positionId={positionId}
          teamName={teamName}
          positionName={positionName}
          canSchedule={canSchedule}
          onScheduleSuccess={handleSuccess}
          onOptimisticSchedule={closeSearch}
          onScheduleError={onScheduleError}
        />
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
};
