/// <reference types="vite/client" />

/** Values `vite.config.ts` inlines into both bundles at build time. */
interface ImportMetaEnv {
  readonly VITE_POSTHOG_KEY: string;
  /** Browser fallback while the organization's own time zone loads; empty when unset. */
  readonly VITE_PLANNING_CENTER_TIME_ZONE: string;
  /** `live`, or the presentation-mode cache namespace under `bun run dev:present`. */
  readonly VITE_PRESENTATION_SCOPE: string;
  readonly VITE_FAVICON: string;
}
