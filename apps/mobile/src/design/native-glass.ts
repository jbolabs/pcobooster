import {
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";

import { supportsLiquidGlass } from "./glass-capability";

export const hasLiquidGlass = supportsLiquidGlass(
  isGlassEffectAPIAvailable(),
  isLiquidGlassAvailable()
);
