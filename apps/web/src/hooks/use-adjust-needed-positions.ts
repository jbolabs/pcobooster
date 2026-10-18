import type { TeamPosition } from "@pcobooster/planning-center-models/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { neededPositionsMutationOptions } from "@/lib/needed-positions-mutation";
import { productClient } from "@/product-client";

/** Open-slot edits share the sidebar cache and run in order for this plan. */
export const useAdjustNeededPositions = (
  serviceTypeId: string,
  planId: string
) => {
  const queryClient = useQueryClient();
  const mutation = useMutation(
    neededPositionsMutationOptions(
      queryClient,
      serviceTypeId,
      planId,
      async ({ position, change }) =>
        await productClient.run((api) =>
          api.neededPositions.adjust({
            params: { serviceTypeId, planId },
            payload: {
              teamId: position.teamId,
              positionName: position.name,
              change,
            },
          })
        ),
      () => {
        toast.error("Couldn't update open slots.");
      }
    )
  );
  return (
    position: Pick<TeamPosition, "id" | "teamId" | "name">,
    change: "add" | "remove"
  ) => {
    mutation.mutate({ position, change });
  };
};
