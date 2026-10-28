import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { jsPluginSettings, selectJsPlugins } from "ultracite/oxlint/js-plugins";
import react from "ultracite/oxlint/react";
import shadcn from "ultracite/oxlint/shadcn";
import tanstack from "ultracite/oxlint/tanstack";
import tanstackJsPlugins from "ultracite/oxlint/tanstack/js-plugins";
import vitest from "ultracite/oxlint/vitest";

const jsPlugins = selectJsPlugins(["react-doctor"]);

export default defineConfig({
  extends: [
    core,
    react,
    tanstack,
    vitest,
    tanstackJsPlugins,
    shadcn,
    antiSlop,
    jsPlugins,
  ],
  ignorePatterns: [...(core.ignorePatterns ?? []), ".artifacts/**", "lint/**"],
  options: { typeAware: true },
  jsPlugins: [
    ...(jsPlugins.jsPlugins ?? []),
    ...(shadcn.jsPlugins ?? []),
    {
      name: "local",
      specifier: "./lint/oxlint-plugin-local.mjs",
    },
    {
      name: "test-quality",
      specifier: "./lint/oxlint-plugin-test-quality.mjs",
    },
  ],
  rules: {
    // Batched reads wait on the batch ahead through `batchHasAnswered`, never a settled check.
    "local/batch-gate-uses-batch-has-answered": "error",
    // Flush list rows keep hover backgrounds on the list's rounded border.
    "local/flush-list-rows": "error",
    // Grid columns can shrink below their content, so long text truncates instead of overflowing.
    "local/grid-tracks-shrink": "error",
    // Keep icons/buttons from overlapping Input/Textarea text; use InputGroup.
    "local/no-absolute-input-overlay": "error",
    // Backgrounds stay solid; no blurred/frosted backdrop-filter layers.
    "local/no-backdrop-blur": "error",
    // Cards and ringed/shadowed surfaces keep room inside scroll containers.
    "local/no-clipped-surface": "error",
    // Icons beside text center on the first line (h-lh box), not with one-off margin nudges.
    "local/no-nudged-icon": "error",
    // Popover shells stay flush; inner sections own spacing.
    "local/no-popover-content-padding": "error",
    // Section dividers use Separator primitives, not border-b headers.
    "local/no-overlay-section-border-b": "error",
    // Hover and selection colors snap instantly; no color fade utilities.
    "local/no-transition-colors": "error",
    // Loading indicators are the shared rocket Spinner, not spinning icons.
    "local/no-animate-spin": "error",
    // Menu group labels render inside a Group or RadioGroup; Base UI throws error 31 otherwise.
    "local/menu-label-inside-group": "error",
    // Controls get their look from components/ui primitives, not call sites.
    "local/prefer-shared-controls": "error",
  },
  overrides: [
    {
      // The surfaces people open on phones: the product, marketing, and their shared UI
      // (docs/mobile-native-audit.md).
      files: ["apps/web/**", "apps/marketing/**", "packages/ui/**"],
      rules: {
        // Text fields stay 16px on touch screens; iOS zooms into anything smaller.
        "local/no-small-field-text": "error",
        // Inner scrollers say what happens at their edge instead of scrolling the page behind.
        "local/scroll-container-overscroll": "error",
        // Search fields and numeric fields open the keyboard that fits them.
        "local/field-keyboard-hints": "error",
      },
    },
    {
      // A test must be able to fail when the code under test does nothing (AGENTS.md "Testing
      // Guidelines"); vitest/expect-expect and anti-slop/no-module-mocking cover the rest.
      files: ["**/*.test.{ts,tsx}"],
      rules: {
        // At least one assertion pins a produced value, not only absence, presence, or type.
        "test-quality/no-spy-only-assertions": "error",
        "test-quality/no-weak-only-assertions": "error",
        // Expected values are literals, not computed with the module under test.
        "test-quality/no-self-referential-expected": "error",
        // The test runs code instead of only reading constants or its own fixtures.
        "test-quality/require-subject-call": "error",
      },
    },
    {
      // The Expo app (React Native). Each rule here assumes the DOM or CSS classes.
      files: ["apps/mobile/**"],
      rules: {
        // React Native styles are objects passed through `style`; there are no CSS classes.
        "shadcn/no-inline-styles": "off",
        // React Native has no semantic HTML tags; `accessibilityRole` is how a role is named.
        "jsx-a11y/prefer-tag-over-role": "off",
      },
    },
    {
      // The Remotion launch video. Every animated value is computed from the frame number
      // and has to reach the element through `style`; CSS transitions can't be captured.
      files: ["apps/video/**"],
      rules: {
        "shadcn/no-inline-styles": "off",
        "react-doctor/no-inline-exhaustive-style": "off",
      },
    },
  ],
  settings: jsPluginSettings,
});
