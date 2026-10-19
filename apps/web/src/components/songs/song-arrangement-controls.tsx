import type { ChordChartArrangement } from "@pcobooster/contracts/http/chord-charts";
import {
  arrangementDisplayName,
  arrangementPickerDetail,
  keyEndingLabel,
  keyLabel,
  songPageSelection,
} from "@pcobooster/planning-center-models/song-detail";
import type {
  SongPageSearch,
  SongPageSelection,
} from "@pcobooster/planning-center-models/song-detail";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverLabel } from "@/components/ui/hover-card";
import { Item } from "@/components/ui/item";
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelMeta,
  PanelRows,
  PanelTitle,
} from "@/components/ui/panel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** The song's page and its chart, which share `?arrangement=&key=`. */
export type SongRoute = "/songs/$songId" | "/songs/$songId/chart";

export interface SongSelection {
  /** Null until the song's arrangements load. */
  readonly selection: SongPageSelection<ChordChartArrangement> | null;
  /** Shows another arrangement or key, replacing the URL. */
  readonly show: (search: SongPageSearch) => void;
}

/**
 * The arrangement and key the URL names, else the first active arrangement and its first key.
 * A stale or missing choice is written back into the URL (replacing it), so a link copied from
 * the page always opens what was on screen.
 */
export const useSongSelection = (
  songId: string,
  route: SongRoute,
  arrangements: readonly ChordChartArrangement[] | undefined,
  requested: SongPageSearch
): SongSelection => {
  const navigate = useNavigate();
  const selection =
    arrangements === undefined
      ? null
      : songPageSelection(arrangements, requested);
  const show = (search: SongPageSearch) => {
    void navigate({
      to: route,
      params: { songId },
      search: { arrangement: search.arrangement, key: search.key },
      replace: true,
    });
  };
  const stale = selection?.stale ?? false;
  const arrangementId = selection?.search.arrangement;
  const keyId = selection?.search.key;
  useEffect(() => {
    if (stale) {
      void navigate({
        to: route,
        params: { songId },
        search: { arrangement: arrangementId, key: keyId },
        replace: true,
      });
    }
  }, [stale, arrangementId, keyId, navigate, route, songId]);
  return { selection, show };
};

const ArrangementMenuItem = ({
  arrangement,
  selected,
  onSelect,
}: {
  arrangement: ChordChartArrangement;
  selected: boolean;
  onSelect: (arrangement: ChordChartArrangement) => void;
}) => {
  const detail = arrangementPickerDetail(arrangement);
  return (
    <DropdownMenuItem
      onClick={() => {
        onSelect(arrangement);
      }}
    >
      {/* The name comes first and keeps its room; tempo and keys sit under it. */}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">
          {arrangementDisplayName(arrangement.name)}
        </span>
        {detail === "" ? null : (
          <span className="text-muted-foreground truncate text-xs font-normal tabular-nums">
            {detail}
          </span>
        )}
      </span>
      <Check className={selected ? undefined : "invisible"} aria-hidden />
      {selected ? <span className="sr-only">(shown)</span> : null}
    </DropdownMenuItem>
  );
};

/**
 * The arrangement shown: its name, or with two or more a quiet menu of them (tempo and keys
 * beside each name, archived ones last). Choosing one shows its first key.
 */
export const ArrangementPicker = ({
  arrangements,
  arrangement,
  onShow,
  flush = false,
}: {
  /** Active first, then archived. */
  arrangements: readonly ChordChartArrangement[];
  arrangement: ChordChartArrangement;
  onShow: (search: SongPageSearch) => void;
  /** Lines the menu's text up with text above it, its hit area reaching into the gutter. */
  flush?: boolean;
}) => {
  const name = arrangementDisplayName(arrangement.name);
  if (arrangements.length < 2) {
    return (
      <p className="min-w-0 truncate text-sm font-medium">
        {name}
        {arrangement.archived ? (
          <span className="text-muted-foreground font-normal"> · Archived</span>
        ) : null}
      </p>
    );
  }
  const active = arrangements.filter((candidate) => !candidate.archived);
  const archived = arrangements.filter((candidate) => candidate.archived);
  const select = (chosen: ChordChartArrangement) => {
    onShow({ arrangement: chosen.id, key: chosen.keys[0]?.id });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            touch="target"
            className={
              flush ? "-ml-3 max-w-full min-w-0" : "max-w-full min-w-0"
            }
            aria-label={`Arrangement: ${name}`}
          />
        }
      >
        <span className="truncate">{name}</span>
        {arrangement.archived ? (
          <span className="text-muted-foreground font-normal">Archived</span>
        ) : null}
        <ChevronDown className="text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuGroup>
          {active.map((candidate) => (
            <ArrangementMenuItem
              key={candidate.id}
              arrangement={candidate}
              selected={candidate.id === arrangement.id}
              onSelect={select}
            />
          ))}
        </DropdownMenuGroup>
        {archived.length === 0 ? null : (
          <>
            {active.length === 0 ? null : <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Archived</DropdownMenuLabel>
              {archived.map((candidate) => (
                <ArrangementMenuItem
                  key={candidate.id}
                  arrangement={candidate}
                  selected={candidate.id === arrangement.id}
                  onSelect={select}
                />
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const ArrangementNavItem = ({
  arrangement,
  selected,
  onShow,
}: {
  arrangement: ChordChartArrangement;
  selected: boolean;
  onShow: (search: SongPageSearch) => void;
}) => {
  const name = arrangementDisplayName(arrangement.name);
  const detail = [
    arrangementPickerDetail(arrangement),
    arrangement.archived ? "Archived" : "",
  ]
    .filter((part) => part !== "")
    .join(" · ");
  return (
    <li>
      <Item
        size="row"
        variant={selected ? "selected" : "default"}
        aria-current={selected ? "page" : undefined}
        render={
          <button
            type="button"
            aria-label={detail === "" ? name : `${name}, ${detail}`}
          />
        }
        onClick={() => {
          if (!selected) {
            onShow({
              arrangement: arrangement.id,
              key: arrangement.keys[0]?.id,
            });
          }
        }}
      >
        <span className="flex min-w-0 flex-1 flex-col px-1.5">
          <span className="truncate">{name}</span>
          {detail === "" ? null : (
            <span className="text-muted-foreground truncate text-xs font-normal tabular-nums">
              {detail}
            </span>
          )}
        </span>
        <Check
          className={selected ? "size-4 shrink-0" : "invisible size-4 shrink-0"}
          aria-hidden
        />
      </Item>
    </li>
  );
};

/**
 * Every arrangement in a panel beside the page, the shown one marked. On phones a song with one
 * arrangement skips it, since there's nothing to choose. Active first, archived last; choosing
 * one shows its first key.
 */
export const ArrangementNav = ({
  arrangements,
  arrangement,
  onShow,
}: {
  /** Active first, then archived. */
  arrangements: readonly ChordChartArrangement[];
  arrangement: ChordChartArrangement;
  onShow: (search: SongPageSearch) => void;
}) => (
  <Panel
    variant="quiet"
    render={<nav aria-label="Arrangements" />}
    className={arrangements.length < 2 ? "max-md:hidden" : undefined}
  >
    <PanelHeader>
      <PanelTitle>Arrangements</PanelTitle>
      <PanelMeta>{arrangements.length}</PanelMeta>
    </PanelHeader>
    <PanelBody>
      <PanelRows render={<ul />}>
        {arrangements.map((candidate) => (
          <ArrangementNavItem
            key={candidate.id}
            arrangement={candidate}
            selected={candidate.id === arrangement.id}
            onShow={onShow}
          />
        ))}
      </PanelRows>
    </PanelBody>
  </Panel>
);

/**
 * The arrangement's keys as tabs, only when it has two or more: the key picks which chart opens
 * and which key's files show. A key that ends elsewhere says so on hover.
 */
export const KeyTabs = ({
  arrangement,
  keyId,
  onShow,
}: {
  arrangement: ChordChartArrangement;
  keyId: string | null;
  onShow: (search: SongPageSearch) => void;
}) => {
  if (arrangement.keys.length < 2 || keyId === null) {
    return null;
  }
  return (
    <Tabs
      value={keyId}
      onValueChange={(value) => {
        const chosen = arrangement.keys.find((key) => key.id === value);
        if (chosen !== undefined && chosen.id !== keyId) {
          onShow({ arrangement: arrangement.id, key: chosen.id });
        }
      }}
      className="min-w-0"
    >
      <TabsList
        variant="line"
        aria-label="Key"
        className="max-w-full justify-start overflow-x-auto overscroll-x-contain group-data-horizontal/tabs:h-10 pointer-coarse:group-data-horizontal/tabs:h-13"
      >
        {arrangement.keys.map((key) => {
          const ending = keyEndingLabel(key);
          if (ending === null) {
            return (
              <TabsTrigger key={key.id} value={key.id} className="flex-none">
                {keyLabel(key)}
              </TabsTrigger>
            );
          }
          return (
            <HoverLabel
              key={key.id}
              label={ending}
              side="bottom"
              render={<TabsTrigger value={key.id} className="flex-none" />}
            >
              {keyLabel(key)}
            </HoverLabel>
          );
        })}
      </TabsList>
    </Tabs>
  );
};
