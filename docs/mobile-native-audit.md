# Mobile-native audit

What makes the product (`apps/web`), the marketing site (`apps/marketing`, with its product replica), and the shared UI (`packages/ui`) feel like a website on a phone, and what changed. Admin is desktop-only behind Cloudflare Access and out of scope. Audited 2026-10-18 against the mobile-native checklist (sticky hover, tap highlight, viewport units, input zoom, keyboard hints, tap delay and press feedback, overscroll, safe areas, user-select, touch-action, theme-color, text-size-adjust, interactive-widget, zoom, device sniffing).

## Where it lives

- `packages/ui/src/mobile-native.css` (`@pcobooster/ui/mobile-native.css`, imported by both apps right after Tailwind): the gated `hover` variant, `can-hover`, the safe-area utilities (`pt-safe`, `pb-safe`, `px-safe`, `pt-safe-*`, `pb-safe-*`), and the base layer (tap highlight, text-size-adjust, touch-action and user-select on controls, 16px fields on coarse pointers).
- `apps/web/src/lib/document-head.ts`: the product's viewport and color-scheme metas. Neither app ships a theme-color meta (finding 26).
- Guards: `lint/mobile-native.test.ts` and the local oxlint rules `local/no-small-field-text`, `local/scroll-container-overscroll`, and `local/field-keyboard-hints` (scoped to web, marketing, and `packages/ui`).

## Guards and what they found

Each guard was written first and run against the untouched code; every offender below is fixed and the guards now pass.

| Guard | Catches | Offenders found |
| --- | --- | --- |
| `local/no-small-field-text` | Field text under 16px not gated to `pointer-fine:` | 5: `input.tsx`, `textarea.tsx`, `native-select.tsx`, `command.tsx` (all `md:text-sm`), `highlighted-textarea.tsx` (`md:text-[13px]`) |
| `local/scroll-container-overscroll` | `overflow-*-auto/scroll` without an `overscroll-*` choice | 18: `app-shell.tsx:168`, `welcome-dialog.tsx:458`, `month-view.tsx:482`, `add-song-palette.tsx:272,428`, `key-transition-popover.tsx:159`, `plan-item-pane.tsx:652`, `plan-person-edit-dialog.tsx:319`, `plan-time-create-dialog.tsx:78`, `service-plan-table-selector.tsx:309`, `chord-chart-import-dialog.tsx:272`, `lyrics-search-panel.tsx:88`, `planning-center-pdf-preview.tsx:162`, `ui/command.tsx:93`, `ui/dropdown-menu.tsx:45`, `ui/highlighted-textarea.tsx:76`, `ui/sidebar.tsx:411`, `ui/table.tsx:5` |
| `local/field-keyboard-hints` | Search and filter fields without keyboard hints; `inputMode="numeric"` for values with separators | 11: search fields in `people-page.tsx:377`, `add-song-palette.tsx:389`, `plan-files-browser.tsx:292`, `selected-position-header.tsx:125`, `someone-else-row.tsx:196`, `service-plan-table-selector.tsx:525`, `service-type-multi-select.tsx:147`, `songs-page.tsx:443`, `time-assignment-selector.tsx:261`; `m:ss` fields in `plan-item-pane.tsx:508`, `plan-item-inline-editors.tsx:207` (the 3 `CommandInput` sites are fixed in the primitive) |
| `lint/mobile-native.test.ts`: stylesheet `:hover` | `:hover` outside `@media (hover: hover) and (pointer: fine)` | 19: web `globals.css` (plan-item divider, scrollbar thumb); marketing `product-demo.module.css` (8: `.candidate`, `.score` hover card, `.plan-row` x4, `.suggestions`), `demo-control.module.css` (9) |
| compiled Tailwind hover (web, marketing) | Every hover class in the source, compiled with each app's real stylesheet | 77 web and 23 marketing rules gated only by `(hover: hover)` or not at all (`[&>a:hover]` in `item.tsx`, `field.tsx`, `empty.tsx`) |
| `(hover: hover)` without a fine pointer | Arbitrary `[@media(hover:hover)]` and `matchMedia` | 6 tokens in `auth-sign-in-card.tsx:174,178` |
| stylesheet field text | Field rules under 16px outside `@media (pointer: fine)` | 2: `.pill-select select` (13px), `.chart-textarea` (12.5px) |
| stylesheet scrollers | `overflow: auto/scroll` without `overscroll-behavior` | 6 in `product-demo.module.css` |
| viewport units, zoom lock, sniffing, touch listeners | `vh`/`h-screen`, `user-scalable`/`maximum-scale`, `navigator.userAgent`/`maxTouchPoints`/`ontouchstart`, non-passive touch or wheel listeners | 0 each (kept as regression guards) |
| document metadata | Viewport parts in both apps, no theme-color meta in either app (head helpers and any source that renders, queries, or writes one), manifest colors | 3: marketing viewport, manifest `theme_color`; the theme-color guard (added for finding 26) failed on 3: product `document-head.ts` and `theme.ts`, marketing `site-head.ts` |

## Findings

Verification: **E** = verified in an emulated mobile browser (Playwright iPhone 15, Chromium and WebKit, `isMobile` + `hasTouch`; safe areas through Chromium's `Emulation.setSafeAreaInsetsOverride`); **G** = held by a guard; **P** = needs a real phone to feel.

| # | Sev | Where | Finding | Fix | Status | Verify |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | high | `apps/web/src/components/ui/input.tsx:14`, `textarea.tsx:11`, `native-select.tsx:26`, `command.tsx:75`, `highlighted-textarea.tsx:20` | Fields drop to 14px (13px chord editor) from `md`, a width guess: iPads and landscape phones over 768px wide zoom on every focus | `md:pointer-fine:text-sm` (text stays 16px on touch at any width); base-layer 16px for coarse pointers in `mobile-native.css` | fixed | E (16px computed), G, P (the zoom itself) |
| 2 | high | `apps/marketing/src/components/ui/demo-control.module.css:256,568`, `product-demo.module.css:29,772` | Replica fields under 16px on phones: key selects 13px, chord textarea 12.5px, other fields inherit 14px | 16px on touch, small size inside `@media (pointer: fine)`; the chord highlight layer matches | fixed | E (12.5/13px before, 16px after), G, P |
| 3 | high | `apps/web/src/components/ui/sonner.tsx:18,76` | Toasts sit 16px from the top on phones while the product draws under the status bar: they land under the notch and Dynamic Island | Offsets add `env(safe-area-inset-*)` | fixed | E (top 16px before, 75px after with 59px inset), P |
| 4 | high | `plan-item-pane.tsx:508`, `plan-item-inline-editors.tsx:207` | Length fields ask for `m:ss` but open iPhone's digits-only keypad, which has no colon | Drop `inputMode="numeric"`; `enterKeyHint="done"` | fixed | G, P (keyboard) |
| 5 | medium | `packages/ui/src/mobile-native.css:14` | Tailwind v4 `hover:` asks only for `(hover: hover)`; touch devices that report hover keep hover states after a tap (100 compiled rules across both apps) | `@custom-variant hover` gated on `(hover: hover) and (pointer: fine)`; `group-hover:` and `peer-hover:` follow | fixed | E (media), G (compiled CSS), P (Android) |
| 6 | medium | `product-demo.module.css:848,1214,1232,1395`, `demo-control.module.css:127-605`, `apps/web/src/styles/globals.css:46,859` | Raw `:hover` rules ungated or `(hover: hover)` only; the replica's fit-score card opens on tap and stays stuck over the list on iPhone | Gate every rule; the replica hides the insert strip on coarse pointers like the product | fixed | E (card stuck before, closed after), G |
| 7 | medium | `ui/item.tsx:193`, `ui/field.tsx:128`, `ui/empty.tsx:67`, `auth-sign-in-card.tsx:174,178` | Arbitrary `[&>a:hover]` bypasses the hover variant; `[@media(hover:hover)]` skips the pointer check | `[&>a]:hover:`; new `can-hover:` variant | fixed | G |
| 8 | medium | `apps/web/src/styles/globals.css:872` | `overscroll-behavior` sat on `body` only; the viewport reads the root, so pull-to-refresh and the page bounce stayed on | `html, body { overscroll-behavior: none }` | fixed | E (html auto before, none after), P (the gesture) |
| 9 | medium | 18 class scrollers (guard table), `ui/scroll-area.tsx:42`, replica CSS | Menus, command lists, dialog bodies, sidebar, tables, and sideways strips chain scroll to the page or trigger back-swipe at their edge | `overscroll-contain` on panels, `overscroll-x-contain` on sideways strips; replica vertical scrollers keep `auto` on purpose (see below) | fixed | E (computed), G, P (feel) |
| 10 | medium | `apps/web/src/routes/__root.tsx`, `lib/document-head.ts`, `lib/theme.ts`, `theme-provider.tsx` | Product had no theme-color (#175 dropped it), so the bars ignored a saved theme and Android painted defaults | Per-scheme metas with the header color, kept on the theme shown after hydration | reverted (finding 26) | P |
| 11 | medium | `apps/web/public/manifest.webmanifest:8` | Installed app `theme_color` was the brand sage `#73866d`, not the header | `#eff2ee` | fixed | G, P (installed PWA) |
| 12 | medium | `apps/marketing/src/lib/site-head.ts:80` | Marketing viewport lacked `viewport-fit=cover` and `interactive-widget=resizes-content` | Added (pinch zoom stays on) | fixed | E (meta), G |
| 13 | medium | `site.tsx:112,152,155,193`, `marketing/styles/globals.css:145`, `marketing/routes/__root.tsx:20` | With cover on, the sticky header, phone menu, footer, skip link, and landscape column need insets | `pt-safe` header and menu, `pb-safe-8` menu and footer, `wrap` clears side insets, skip link shifts by the top inset | fixed | E (header 59px; landscape column at 79px with 59px insets), P |
| 14 | medium | `ui/sidebar.tsx:251,255,334` | Landscape phones (over 768px) get the desktop sidebar layout at x=0, under the notch; the inset padded sides only below `md` | Sidebar container pads by the left/bottom insets; inset pads right, and left when collapsed | fixed | G (compiled), P |
| 15 | medium | `ui/sheet.tsx:57` | Sheets (the phone sidebar sheet) had no safe-area padding; the close button sat under the status bar | Per-side safe padding and close-button offsets | fixed | G (compiled), P |
| 16 | medium | `ui/button-variants.ts:15`, `ui/dropdown-menu.tsx:103,128,177,213`, `ui/item.tsx:84`, `mobile-menu.tsx:70,146`, `demo-control.module.css:155`, marketing `ui/button.tsx`, `site.tsx` | With hover gated and tap highlight off, buttons, menu items, link rows, and phone menu links gave no color on press | Instant `active:` colors matching each hover color (no transition; same look on desktop) | fixed | E (row `rgba(0,0,0,0)` before, filled after), P (feel) |
| 17 | medium | `packages/ui/src/mobile-native.css:95`, web `globals.css:884`, `ui/item.tsx:84` | Long-press selected control labels: marketing 175 of 184 controls selectable, product tabs, menu items, sidebar links | `user-select: none` and `-webkit-touch-callout: none` on buttons and control roles only; link rows and menu links get `select-none` but keep the link callout; content text stays selectable | fixed | E (0 of 184 selectable after), P (long press) |
| 18 | low | marketing `styles/globals.css` | Tap highlight only on `a, button, summary`; `text-size-adjust` without the `-webkit-` prefix iOS reads; no `touch-action: manipulation` on marketing controls | Shared base layer on `html` and controls | fixed | E (computed) |
| 19 | low | `ui/sidebar.tsx:163,251` | App shell used `svh` (`min-h-svh`, `h-svh`) | `dvh` | fixed | G |
| 20 | low | `songs-page.tsx:365` | Search autofocus skipped by width (`useIsMobile`), a touch guess: iPads got the keyboard over the list | `(pointer: coarse)` | fixed | E (media), P |
| 21 | low | `welcome-dialog.tsx:244` | The guide's showcase resumed autoplay right after a tap (touch fires pointerleave on lift) | Only a mouse leaving releases the hold | fixed | P |
| 22 | low | `product-demo/day-bars.tsx:219` | Replica day card flashed closed on lift | Same: only a mouse closes it on leave | fixed | E (0 open before, 1 after) |
| 23 | low | search fields (guard table), `ui/command.tsx:70`, `lyrics-search-panel.tsx`, `chord-chart-import-dialog.tsx:227`, `plan-item-pane.tsx:166`, `plan-time-form-fields.tsx` | Keyboard capitalized and autocorrected queries and chord names; return key said "return" | `enterKeyHint="search"`, `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck={false}` on searches; `done` on Enter-to-blur fields | fixed | G, P (keyboard) |
| 24 | low | `worst-case-data-toggle.tsx:19` | Dev-only toggle under the home indicator | Bottom inset | fixed | G |
| 25 | low | Sonner CSS, React Query Devtools | Third-party `:hover` rules (Sonner close button, devtools) | Sonner's close button isn't enabled; devtools are dev-only | not fixed: third party, not reachable on phones | E |
| 26 | high | `apps/web/src/routes/__root.tsx`, `lib/document-head.ts`, `lib/theme.ts`, `theme-provider.tsx`, `apps/marketing/src/lib/site-head.ts` | On an iPhone (Safari, signed in), opening the phone menu left a line above Safari's bottom bar on every page until a reload; not reported on `main`, which has no product theme-color | Drop the theme-color metas and their runtime writer from the product, and the marketing meta (the same menu opens there); keep the manifest `theme_color` for the installed app | fixed (hypothesis, see below) | E (page state), G, P (the line) |

## Already right (verified, unchanged)

- Product viewport already had `viewport-fit=cover, interactive-widget=resizes-content`; tap highlight, text-size-adjust, and `touch-action: manipulation` were already global in the product (E).
- The phone header pads with `pt-safe`; the plan toolbar, file viewer, drawers, and page shells pad the bottom inset; drawers contain overscroll (code).
- No `100vh`, `h-screen`, zoom lock, user-agent sniffing, or non-passive touch listeners anywhere in scope (G). Sign-in and demo entry use `min-h-svh` (E).
- `useIsMobile` elsewhere picks layout by width (drawer or dialog), not touch; kept.

## Intentional choices

- Marketing is a scrolling document, so its root keeps pull-to-refresh and the page bounce. The replica's vertical scrollers keep `overscroll-behavior: auto` so a swipe at their end carries on down the page; its sideways strips contain.
- No theme-color meta in either app (finding 26): Safari tints its bars from the page, as #175 set up. Android Chrome paints its default bar color in the browser; the installed app takes the manifest's `#eff2ee`.
- `apple-mobile-web-app-status-bar-style` stays `default`: `black-translucent` would draw white status text over the light header.
- Hover cards (Base UI preview cards) still don't open on touch, matching the product's design; the replica's fit card now matches.
- iOS applies `:active` only with a touchstart listener in the tree; React's root listeners provide one in both apps.

## Needs a real phone

Emulation can't show the zoom, the software keyboard (keypads, return-key labels, `interactive-widget` resizing on Android), tap delay feel, rubber-band and pull-to-refresh physics, real notch and home-indicator rendering, long-press callouts and selection, and installed-PWA bars. Check on an iPhone (Safari and installed) and an Android phone: focus a search field and the chord editor, edit a plan item length, pull at the top of a page, open a menu and scroll past its end, rotate to landscape with the sidebar open, trigger a toast, and long-press a button.

## Demos

Before and after clips (Playwright iPhone 15 emulation, Chromium) live outside the repo in `/workspace/mobile-native-demos/` (see its README): input zoom, stuck hover, press feedback, toast safe area, day-bar tap, and the computed baseline. Signed-in product pages need Planning Center credentials and the API, so product clips use the sign-in page; the replica stands in for services, plans, people, and songs.

## Finding 26: the line above Safari's bottom bar after the phone menu

**Symptom (real iPhone, Safari, signed in):** everything looks right until the phone menu opens. From then on a line sits just above Safari's bottom bar on every page, until a reload. Not reported on `main`.

**What emulation showed (Playwright WebKit, iPhone 15, a harness of the signed-in phone shell with each side's compiled `globals.css` and document metas; `/workspace/mobile-demo-tools/harness`):** open and close leave the page exactly as it was on both `main` and this branch. html and body inline styles and attributes return to their pre-open values, nothing fixed remains at the bottom edge, `elementFromPoint` at the bottom edge hits the same row, the overlay is `display: none` again, and before and after screenshots are pixel-identical. So nothing on the page itself sticks. WebKit emulation doesn't draw Safari's bars, so the line itself was **not reproduced**.

**Ruled out:** Base UI's scroll lock. The phone menu doesn't use it: `useMobileMenu` sets and clears `html` `overflow` itself, unchanged from `main`. Base UI 1.9 (`@base-ui/utils/useScrollLock.js`) uses `preventScrollOverlayScrollbars` on iOS, which only sets `overflow` on the scroll element and restores it. No `data-base-ui-scroll-locked`, `position: fixed`, padding, or gutter is involved. No portal or backdrop stays mounted, and nothing on the page changes theme-color.

**Cause (hypothesis, needs the iPhone to confirm):** while open, the menu is a frosted (`backdrop-filter`) full-screen fixed layer. In WebKit's `LocalFrameView::fixedContainerEdges`, a backdrop filter at an edge reports that edge as `Multiple`. WKWebView then fills Safari's bar areas with a solid color-extension view instead of the soft glass over the page (WebKit bug 300965: "both top and bottom become solid color once the side menu shows up", with reports that it stays after close). Safari only recomputes these edges on a load commit, on fixed layers appearing or disappearing, or on inset changes, so client-side navigation keeps whatever state Safari settles in. Of the inputs Safari reads for its bars, the only one this branch changed on the product is the theme-color metas. #175 dropped them because, on Jake's iPhone, Safari painted its bars that flat color. The fix returns the product to the `main` state. The root `overscroll-behavior: none` (finding 8) is the other bar-adjacent change; keep it unless the line survives this fix on the iPhone.

**Guard:** `lint/mobile-native.test.ts` "leaves the product's / marketing's browser bars to the page, with no theme-color" pins each app's head metas to `charSet`, `viewport`, `color-scheme`. "renders, queries, or writes no theme-color meta anywhere in either app" scans web, marketing, and `packages/ui` source. On the unfixed code it failed on marketing's head and on `apps/web/src/lib/document-head.ts`, `apps/web/src/lib/theme.ts`, and `apps/marketing/src/lib/site-head.ts`.

**Check on the iPhone:** open and close the phone menu on a plan list, scroll, and navigate to another section. The bottom bar should stay glass over the page, with no line.
