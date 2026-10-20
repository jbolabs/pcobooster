import { useLocalSearchParams } from "expo-router";

import { useNavigationPath } from "../../app-shell/use-navigation-path";
import { songPathInPlan } from "./route-context";

export const useSongPath = () => {
  const navigationPath = useNavigationPath();
  const params = useLocalSearchParams<{
    "service-type-id"?: string;
    "plan-id"?: string;
  }>();
  const serviceTypeId = params["service-type-id"];
  const planId = params["plan-id"];
  return (path: string) =>
    navigationPath(
      songPathInPlan(
        path,
        serviceTypeId === undefined || planId === undefined
          ? undefined
          : { serviceTypeId, planId }
      )
    );
};
