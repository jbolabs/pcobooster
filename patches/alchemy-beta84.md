# Alchemy beta 84 local runner patch

`@alchemy.run/cloudflare@2.0.0-beta.84` selects its published TypeScript sources when called by Bun, then launches Vite dev on Node. The published Alchemy package omits `bin/register-dev-mode.js`, so the source runner fails before serving a page. The patch selects the shipped `lib/Workers` runner for a published source import; source checkouts and Node imports keep their existing resolution.

Reproduced with `bun alchemy dev` and verified by starting the real local Worker and requesting rendered pages. Keep this patch version-specific; remove it when an upstream release fixes the Bun-to-Node runner boundary and passes local smoke.
