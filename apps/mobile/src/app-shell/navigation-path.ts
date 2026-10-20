export type AppTab = "services" | "people" | "songs" | "search";

/** Detail navigation belongs to the originating tab, so Back restores its list and search. */
export const navigationPath = (path: string, tab: AppTab): string =>
  path === `/${tab}` ||
  path.startsWith(`/${tab}/`) ||
  path.startsWith(`/${tab}?`)
    ? path
    : `/${tab}${path}`;

export const navigationTab = (segments: readonly string[]): AppTab => {
  const [, tab] = segments;
  return tab === "people" || tab === "songs" || tab === "search"
    ? tab
    : "services";
};
