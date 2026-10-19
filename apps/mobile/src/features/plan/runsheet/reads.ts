import { callForQuery } from "@pcobooster/client/query";
import { queryOptions } from "@tanstack/react-query";

import type { PlanReadContext } from "../reads";

export const songReads = {
  options: (
    { client, scope }: PlanReadContext,
    serviceTypeId: string,
    songId: string
  ) =>
    queryOptions({
      queryKey: [scope, "songs.options", serviceTypeId, songId],
      queryFn: async (context) => {
        const targetClientNative1 = client;
        const inputNative1 = { serviceTypeId, songId };
        return await callForQuery(context, targetClientNative1, (api) =>
          api.songs.options({ params: inputNative1 })
        );
      },
      staleTime: 600_000,
    }),
  search: ({ client, scope }: PlanReadContext, query: string) =>
    queryOptions({
      queryKey: [scope, "songs.search", query],
      queryFn: async (context) => {
        const targetClientNative2 = client;
        const inputNative2 = { query };
        return await callForQuery(context, targetClientNative2, (api) =>
          api.songs.search({ query: inputNative2 })
        );
      },
      staleTime: 60_000,
    }),
  /** `songs.schedule`: the song's plans, and whether Planning Center had more than were read. */
  schedule: ({ client, scope }: PlanReadContext, songId: string) =>
    queryOptions({
      queryKey: [scope, "songs.schedule", songId] as const,
      queryFn: async (context) =>
        await callForQuery(context, client, (api) =>
          api.songs.schedule({ params: { songId } })
        ),
      staleTime: 60_000,
    }),
};
