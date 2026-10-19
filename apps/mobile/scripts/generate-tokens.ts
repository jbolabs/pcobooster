// Syncs assets/colors from the web design tokens, then writes src/design/colors.generated.ts.
// Run: bun run tokens
import { writeFileSync } from "node:fs";

import { generatedPath, renderColorTokens } from "./color-tokens.ts";
import { syncColorSetsFromWeb } from "./web-color-tokens.ts";

const changed = syncColorSetsFromWeb();
if (changed.length > 0) {
  process.stdout.write(`Synced from tokens.css: ${changed.join(", ")}\n`);
}
writeFileSync(generatedPath, renderColorTokens());
