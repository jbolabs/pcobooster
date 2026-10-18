import type {
  TeamPosition,
  TeamPositionGroup,
} from "@pcobooster/planning-center-models/types";
import { mutationOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { queryKeys, scheduleMutationKey } from "@/lib/query-keys";
import { clearCachedTeamPositions } from "@/lib/team-positions-cache";

interface NeededPositionEdit {
  position: Pick<TeamPosition, "id" | "teamId" | "name">;
  change: "add" | "remove";
}

export const neededPositionsMutationOptions = (
  queryClient: QueryClient,
  serviceTypeId: string,
  planId: string,
  adjust: (edit: NeededPositionEdit) => Promise<{ openCount: number }>,
  onError: () => void
) => {
  const queryKey = queryKeys.teamPositions(serviceTypeId, planId, null);
  const mutationKey = [
    ...scheduleMutationKey,
    "needed-positions",
    serviceTypeId,
    planId,
  ] as const;
  const updatePosition = (
    position: NeededPositionEdit["position"],
    update: (open: number) => number
  ) => {
    let delta = 0;
    queryClient.setQueryData<TeamPositionGroup[]>(queryKey, (groups) =>
      groups?.map((group) =>
        group.teamId === position.teamId
          ? {
              ...group,
              positions: group.positions.map((candidate) => {
                if (candidate.id !== position.id) {
                  return candidate;
                }
                const previous = candidate.neededCount ?? 0;
                const neededCount = Math.max(0, update(previous));
                delta = neededCount - previous;
                return { ...candidate, neededCount };
              }),
            }
          : group
      )
    );
    return delta;
  };
  return mutationOptions({
    mutationKey,
    scope: { id: `needed-positions:${serviceTypeId}:${planId}` },
    mutationFn: adjust,
    onMutate: async ({ position, change }: NeededPositionEdit) => {
      await queryClient.cancelQueries({ queryKey });
      return {
        delta: updatePosition(
          position,
          (open) => open + (change === "add" ? 1 : -1)
        ),
      };
    },
    onError: (_error, { position }, context) => {
      updatePosition(position, (open) => open - (context?.delta ?? 0));
      onError();
    },
    onSuccess: ({ openCount }, { position }) => {
      if (queryClient.isMutating({ mutationKey }) === 1) {
        updatePosition(position, () => openCount);
      }
    },
    onSettled: async () => {
      clearCachedTeamPositions();
      if (queryClient.isMutating({ mutationKey }) === 1) {
        await queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};
