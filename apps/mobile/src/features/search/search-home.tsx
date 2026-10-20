import {
  buildServicePlanRows,
  formatPlanDate,
} from "@pcobooster/planning-center-models/service-plans";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { accountHeaderItem } from "../../app-shell/account-button";
import { useFeatures } from "../../app-shell/features";
import {
  failureMessage,
  sharedReads,
  useProductClient,
} from "../../app-shell/queries";
import {
  useVisibleQuery as useQuery,
  useVisibleQueries as useQueries,
  useReadVisibility,
} from "../../app-shell/visible-queries";
import { EmptyState } from "../../components/empty-state";
import { PillButton } from "../../components/pill-button";
import { SkeletonRow } from "../../components/skeleton";
import { SurfaceCard } from "../../components/surface-card";
import { AppText } from "../../design/app-text";
import { colors } from "../../design/colors";
import { Spacing } from "../../design/metrics";
import { useClock, useOrgTimeZone } from "../../lib/environment";
import {
  recentDestination,
  recentIdentity,
  visibleRecents,
  matchingPlans,
  normalizedSearch,
  resultRoute,
  SEARCH_DELAY_MS,
  SEARCH_MAX_LENGTH,
} from "./model";
import type { SearchDomain, SearchRecent } from "./model";
import {
  searchReads,
  searchRecentsQuery,
  rememberSearchItem,
  removeSearchItem,
} from "./reads";

const PLAN_READ_BATCH = 4;
const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: colors.surfaceCanvas },
  content: {
    padding: Spacing.lg,
    gap: Spacing.lg,
    paddingBottom: Spacing.xxxl,
  },
  input: {
    color: colors.ink,
    backgroundColor: colors.surfaceCard,
    padding: Spacing.md,
    fontSize: 17,
    borderRadius: 12,
  },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  section: { gap: Spacing.sm },
  row: { paddingVertical: Spacing.md, gap: Spacing.xs, minHeight: 44 },
});

/** Placeholder rows while a section has no results to show yet. */
const SEARCH_SKELETON_WIDTHS = [
  [170, 110],
  [130, 90],
  [190, 120],
] as const;

interface ResultRow {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly route: string;
  readonly recent: SearchRecent;
}
interface SearchSectionProps {
  readonly title: string;
  readonly rows: readonly ResultRow[];
  readonly loading: boolean;
  readonly error: Error | null;
  readonly onRetry: () => void;
  readonly onOpen: (row: ResultRow) => void;
}
const SearchSection = ({
  title,
  rows,
  loading,
  error,
  onRetry,
  onOpen,
}: SearchSectionProps) => (
  <View style={styles.section}>
    <AppText accessibilityRole="header" font="cardTitle">
      {title}
    </AppText>
    {loading && rows.length === 0 ? (
      <SurfaceCard>
        <View accessibilityLabel={`Searching ${title}`} accessible>
          {SEARCH_SKELETON_WIDTHS.map(([titleWidth, detailWidth]) => (
            <SkeletonRow
              detailWidth={detailWidth}
              key={`${titleWidth}-${detailWidth}`}
              showsAvatar={false}
              titleWidth={titleWidth}
            />
          ))}
        </View>
      </SurfaceCard>
    ) : null}
    {error === null ? null : (
      <View style={styles.section}>
        <AppText font="rowDetail">
          {failureMessage(error)} Cached results may be incomplete.
        </AppText>
        <PillButton onPress={onRetry} title="Retry" />
      </View>
    )}
    {rows.length === 0 && !loading && error === null ? (
      <AppText font="rowDetail" color={colors.inkSecondary}>
        No matching {title.toLowerCase()}.
      </AppText>
    ) : null}
    {rows.length === 0 ? null : (
      <SurfaceCard>
        {rows.map((row) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${row.title}, ${row.detail}`}
            key={row.key}
            testID={`search-result-${row.key}`}
            onPress={() => {
              onOpen(row);
            }}
            style={styles.row}
          >
            <AppText font="rowTitle">{row.title}</AppText>
            <AppText font="rowDetail" color={colors.inkSecondary}>
              {row.detail}
            </AppText>
          </Pressable>
        ))}
      </SurfaceCard>
    )}
  </View>
);

const availableDomains = (
  features: { readonly people: boolean; readonly chordCharts: boolean },
  access:
    | {
        readonly people: { readonly status: string };
        readonly services: { readonly status: string };
      }
    | undefined
): SearchDomain[] => {
  const available: SearchDomain[] = ["all"];
  if (access?.services.status === "granted") {
    available.push("plans");
  }
  if (features.people && access?.people.status === "granted") {
    available.push("people");
  }
  if (features.chordCharts && access?.services.status === "granted") {
    available.push("songs");
  }
  return available;
};

const useSearch = () => {
  const context = useProductClient();
  const cache = useQueryClient();
  const router = useRouter();
  const features = useFeatures();
  const timeZone = useOrgTimeZone();
  const clock = useClock();
  const focused = useReadVisibility();
  const [text, setText] = useState("");
  const [settled, setSettled] = useState("");
  const [domain, setDomain] = useState<SearchDomain>("all");

  const recentQuery = useQuery(searchRecentsQuery(context.scope));
  const query = normalizedSearch(text);
  useEffect(() => {
    const timeout = setTimeout(() => {
      setSettled(query);
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, [query]);
  const remember = () => {
    const textToKeep = text.trim();
    if (textToKeep !== "") {
      rememberSearchItem(cache, context.scope, {
        kind: "query",
        text: textToKeep,
      });
    }
  };
  const clearRecents = () => {
    cache.setQueryData(searchRecentsQuery(context.scope).queryKey, []);
  };
  const access = useQuery({
    ...sharedReads.access(context),
    subscribed: focused,
    enabled: focused,
  });
  const available = availableDomains(features, access.data);
  const recents = visibleRecents(recentQuery.data ?? [], available);
  const effectiveDomain = available.includes(domain) ? domain : "all";
  const showPlans =
    available.includes("plans") &&
    (effectiveDomain === "all" || effectiveDomain === "plans");
  const showPeople =
    available.includes("people") &&
    (effectiveDomain === "all" || effectiveDomain === "people");
  const showSongs =
    available.includes("songs") &&
    (effectiveDomain === "all" || effectiveDomain === "songs");
  const searching = focused && query !== "" && query === settled;
  const serviceTypes = useQuery({
    ...searchReads.serviceTypes(context),
    subscribed: focused,
    enabled: searching && showPlans,
  });
  const types = serviceTypes.data ?? [];
  const firstUnresolved = types.findIndex((type) => {
    const state = cache.getQueryState(
      searchReads.plans(context, type.id).queryKey
    );
    return state === undefined || state.status === "pending";
  });
  const admittedPlans =
    firstUnresolved === -1 ? types.length : firstUnresolved + PLAN_READ_BATCH;
  const planQueries = useQueries({
    subscribed: focused,
    queries: types.map((type, index) => ({
      ...searchReads.plans(context, type.id),
      enabled: searching && showPlans && index < admittedPlans,
    })),
  });
  // The last answers stay up while the next search loads, so results never blank between keys.
  const people = useQuery({
    ...searchReads.people(context, settled),
    subscribed: focused,
    enabled: searching && showPeople && settled.length >= 2,
    // Below two characters there is no people search, so earlier answers no longer apply.
    placeholderData: query.length >= 2 ? keepPreviousData : undefined,
  });
  const songs = useQuery({
    ...searchReads.songs(context, settled),
    subscribed: focused,
    enabled: searching && showSongs,
    placeholderData: keepPreviousData,
  });
  // These keys belong only to Search. Catalog reads are shared with Services and remain owned
  // by any other visible observer; disabling this observer never cancels their shared work.
  useEffect(
    () => () => {
      void cache.cancelQueries({
        queryKey: [context.scope, "search.people", settled],
        exact: true,
      });
      void cache.cancelQueries({
        queryKey: [context.scope, "search.songs", settled],
        exact: true,
      });
    },
    [cache, context.scope, settled]
  );
  const plans = buildServicePlanRows(
    types,
    (_type, index) => planQueries[index]?.data,
    new Set(types.map((type) => type.id))
  );
  const planRows = matchingPlans(plans, text, clock.now(), timeZone).map(
    (plan) => ({
      key: `${plan.serviceTypeId}:${plan.planId}`,
      title: plan.planTitle || plan.serviceTypeName,
      detail: `${plan.serviceTypeName} · ${formatPlanDate(plan.sortDate, timeZone)}`,
      route: resultRoute("plans", plan.planId, plan.serviceTypeId),
      recent: {
        kind: "plans" as const,
        id: plan.planId,
        serviceTypeId: plan.serviceTypeId,
        title: plan.planTitle || plan.serviceTypeName,
        detail: `${plan.serviceTypeName} · ${formatPlanDate(plan.sortDate, timeZone)}`,
      },
    })
  );
  const open = (row: ResultRow) => {
    rememberSearchItem(cache, context.scope, row.recent);
    router.push(row.route);
  };
  const openRecent = (item: SearchRecent) => {
    if (item.kind === "query") {
      setText(item.text);
    } else {
      const path = recentDestination(item);
      if (path !== null && available.includes(item.kind)) {
        rememberSearchItem(cache, context.scope, item);
        router.push(path);
      }
    }
  };
  const removeRecent = (item: SearchRecent) => {
    removeSearchItem(cache, context.scope, item);
  };
  const waiting = query !== settled;
  return {
    access,
    serviceTypes,
    planQueries,
    people,
    songs,
    showPlans,
    showPeople,
    showSongs,
    searching,
    waiting,
    planRows,
    query,
    open,
    available,
    domain: effectiveDomain,
    setDomain,
    text,
    setText,
    remember,
    recents,
    clearRecents,
    openRecent,
    removeRecent,
  };
};

const SearchIntro = ({
  recents,
  openRecent,
  removeRecent,
  clearRecents,
}: {
  readonly recents: readonly SearchRecent[];
  readonly openRecent: (item: SearchRecent) => void;
  readonly removeRecent: (item: SearchRecent) => void;
  readonly clearRecents: () => void;
}) => (
  <View style={styles.section}>
    <EmptyState
      artwork="search"
      title="Search your organization"
      description="Find plans by service, title, series, or date; find people and songs by name."
    />
    {recents.map((recent) => (
      <View key={recentIdentity(recent)} style={styles.section}>
        <Pressable
          accessibilityRole="button"
          testID={`search-recent-${recentIdentity(recent)}`}
          onPress={() => {
            openRecent(recent);
          }}
          style={styles.row}
        >
          <AppText font="rowTitle">
            {recent.kind === "query" ? recent.text : recent.title}
          </AppText>
          {recent.kind === "query" ? null : (
            <AppText font="rowDetail">{recent.detail}</AppText>
          )}
        </Pressable>
        <PillButton
          testID={`search-recent-remove-${recentIdentity(recent)}`}
          title={`Remove ${recent.kind === "query" ? recent.text : recent.title}`}
          size="small"
          onPress={() => {
            removeRecent(recent);
          }}
        />
      </View>
    ))}
    {recents.length === 0 ? null : (
      <PillButton title="Clear recent searches" onPress={clearRecents} />
    )}
  </View>
);

const firstSearchError = (
  catalog: Error | null,
  queries: readonly { readonly error: Error | null }[]
): Error | null =>
  catalog ?? queries.find((read) => read.error !== null)?.error ?? null;

const ScopedSearch = () => {
  const {
    access,
    serviceTypes,
    planQueries,
    people,
    songs,
    showPlans,
    showPeople,
    showSongs,
    searching,
    waiting,
    planRows,
    query,
    open,
    available,
    domain,
    setDomain,
    text,
    setText,
    remember,
    recents,
    clearRecents,
    openRecent,
    removeRecent,
  } = useSearch();
  return (
    <View style={styles.canvas}>
      <Stack.Screen
        options={{
          title: "Search",
          unstable_headerRightItems: () => [accountHeaderItem()],
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <TextInput
          accessibilityLabel="Search plans, people, and songs"
          testID="search-input"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          maxLength={SEARCH_MAX_LENGTH}
          onChangeText={setText}
          onSubmitEditing={remember}
          placeholder="Search plans, people, and songs"
          placeholderTextColor={colors.inkSecondary}
          returnKeyType="search"
          style={styles.input}
          value={text}
        />
        <View style={styles.filters}>
          {available.map((item) => (
            <PillButton
              key={item}
              testID={`search-filter-${item}`}
              kind={domain === item ? "primary" : "outline"}
              onPress={() => {
                setDomain(item);
              }}
              title={item[0]?.toUpperCase() + item.slice(1)}
            />
          ))}
        </View>
        {access.error === null ? null : (
          <View>
            <AppText font="rowDetail">{failureMessage(access.error)}</AppText>
            <PillButton
              title="Retry permissions"
              onPress={() => {
                void access.refetch();
              }}
            />
          </View>
        )}
        {!access.isPending && available.length === 1 ? (
          <EmptyState
            artwork="alert"
            title="No searchable areas"
            description="Your Planning Center access and account features do not enable plan, people, or song searches."
          />
        ) : null}
        {query === "" ? (
          <SearchIntro
            recents={recents}
            openRecent={openRecent}
            removeRecent={removeRecent}
            clearRecents={clearRecents}
          />
        ) : (
          <>
            {showPlans ? (
              <SearchSection
                title="Plans"
                rows={planRows}
                loading={
                  (searching || waiting) &&
                  (serviceTypes.isPending ||
                    planQueries.some((read) => read.isPending))
                }
                error={firstSearchError(serviceTypes.error, planQueries)}
                onRetry={() => {
                  void serviceTypes.refetch();
                  for (const read of planQueries) {
                    if (read.isError) {
                      void read.refetch();
                    }
                  }
                }}
                onOpen={open}
              />
            ) : null}
            {showPeople && query.length >= 2 ? (
              <SearchSection
                title="People"
                rows={(people.data ?? []).map((person) => ({
                  key: person.id,
                  title: person.fullName,
                  detail: "Person",
                  route: resultRoute("people", person.id),
                  recent: {
                    kind: "people" as const,
                    id: person.id,
                    title: person.fullName,
                    detail: "Person",
                  },
                }))}
                loading={(searching || waiting) && people.isPending}
                error={people.error}
                onRetry={() => {
                  void people.refetch();
                }}
                onOpen={open}
              />
            ) : null}
            {showPeople && query.length < 2 ? (
              <AppText font="rowDetail">
                Type at least two characters to search people.
              </AppText>
            ) : null}
            {showSongs ? (
              <SearchSection
                title="Songs"
                rows={(songs.data ?? []).flatMap((song) =>
                  song.hidden
                    ? []
                    : [
                        {
                          key: song.id,
                          title: song.title,
                          detail: song.author || "Song",
                          route: resultRoute("songs", song.id),
                          recent: {
                            kind: "songs" as const,
                            id: song.id,
                            title: song.title,
                            detail: song.author || "Song",
                          },
                        },
                      ]
                )}
                loading={(searching || waiting) && songs.isPending}
                error={songs.error}
                onRetry={() => {
                  void songs.refetch();
                }}
                onOpen={open}
              />
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
};

export const SearchHome = () => {
  const { scope } = useProductClient();
  return <ScopedSearch key={scope} />;
};
