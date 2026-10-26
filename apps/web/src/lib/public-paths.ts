import { INDEXNOW_KEY_PATH } from "@/lib/indexnow";

/** One page per key change, such as `/key-transitions/g-to-b-flat`. */
const KEY_TRANSITION_PAGE = /^\/key-transitions\/[a-z0-9-]+\/?$/u;

/**
 * Public marketing pages, their prerendered assets, the files crawlers read, and the deployed
 * version, never product APIs.
 */
export const isPublicPath = (pathname: string): boolean =>
  pathname === "/" ||
  pathname === "/about" ||
  pathname === "/about/" ||
  pathname === "/privacy" ||
  pathname === "/privacy/" ||
  pathname === "/terms" ||
  pathname === "/terms/" ||
  pathname === "/key-transitions" ||
  pathname === "/key-transitions/" ||
  KEY_TRANSITION_PAGE.test(pathname) ||
  pathname === "/robots.txt" ||
  pathname === "/sitemap.xml" ||
  pathname === INDEXNOW_KEY_PATH ||
  pathname === "/version" ||
  pathname.startsWith("/marketing/");
