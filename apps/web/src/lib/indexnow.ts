/**
 * The IndexNow key for pcobooster.com. It is public by design: search engines fetch it from
 * `INDEXNOW_KEY_PATH` to confirm that a submission came from the site's owner, and
 * `apps/web/public` serves that file. `scripts/search/indexnow.ts` submits with it.
 */
export const INDEXNOW_KEY = "c2d95222b2bd4d26cc55e31663139aa3";

export const INDEXNOW_KEY_PATH = `/${INDEXNOW_KEY}.txt`;
