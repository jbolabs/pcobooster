import { useSegments } from "expo-router";

import { navigationPath, navigationTab } from "./navigation-path";

export const useNavigationPath = () => {
  const tab = navigationTab(useSegments());
  return (path: string) => navigationPath(path, tab);
};
