/**
 * Reads the wall clock. Components call this instead of `new Date()` so each
 * render still sees the current instant while the clock read stays named.
 */
export const currentDate = (): Date => new Date();
