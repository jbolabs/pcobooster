# pcobooster.com launch video

Three cuts of the launch video. Built with [Remotion](https://www.remotion.dev): the product shots are the marketing site's interactive replica (`apps/marketing/src/components/product-demo`) driven frame by frame, so they always match the shipped UI and re-render when it changes.

| Composition | Length | Use |
| --- | --- | --- |
| `Teaser15-*` | 15s | Feed teaser: the problem, one fill, a key change smoothed out, the ask |
| `Demo50-*` | ~65s | The launch demo: planning one Sunday, from picking it on Services and seeing what's open to filling a spot (with the history behind the choice), building the set, smoothing its keys, looking after the people, and saving it all back |
| `Walkthrough70-*` | ~64s | Walkthrough with room for a voiceover |

Formats: `-4x5` (1080×1350) is the one to post on LinkedIn and Instagram feeds, where it plays largest on a phone; `-16x9` is for YouTube, X, and the site; `-9x16` is for Reels, TikTok, and Shorts. Vertical text stays inside the band that feed UI leaves clear (below the top ~14%, above the bottom ~24%). The walkthrough renders in 16:9 and 9:16 only. The demo's 9:16 plays its 4:5 cut unchanged (desktop replica, same zooms) on a full-height stage, with the headline at the top safe line.

The demo's scenes (`src/scenes/story-scenes.tsx`) carry one plan from start to finish: each applies the earlier scenes' changes, and from the assign view on the product window stays in place while the camera eases out, the screen changes, and it eases in again, so it reads as one app being used. Camera moves always start from where the camera is and aim only where the pan clamp lets them go; the replica's scroll-into-view is turned off in the video (`src/lib/no-scroll-into-view.ts`) because it scrolled the product window differently in each render tab. Captions carry it with the sound off. Cursor clicks, the saved toast, and each row saving back play short sounds from `public/sfx/` (synthesized, no license needed).

The feed cuts are scored with "Busted Jazz" from Holizna's _Lo-Fi and Chill_, released CC0 on the [Free Music Archive](https://freemusicarchive.org/music/holiznacc0/lo-fi-and-chill) (no license fee or credit required), trimmed and loudness-normalized to -14 LUFS in `public/music/`. It runs at 90 BPM, a beat every 20 frames; the file starts 53.97s into the track, on the downbeat where its fuller section comes in, and every scene lasts whole beats, so each cut lands on one. The mix sits around -15.5 LUFS. To swap the track, replace the file and `MUSIC` in `src/cuts.tsx`, and keep any replacement CC0 or CC BY: NoDerivatives and NonCommercial licenses rule out a soundtrack.

## Commands

- `bun run studio`: open Remotion Studio to scrub and tweak every composition.
- `bun run render`: render every composition to `out/<composition>.mp4` (H.264, CRF 16). Name compositions to render only those: `bun run render Demo50-4x5`.
- `bun run stills <composition> <frame>...`: render review PNGs to `out/stills/`.

## How it fits together

- `src/cuts.tsx`: the three cuts as lists of scenes and durations (30 fps).
- `src/scenes/`: brand scenes (hook, Planning Center Services, rocket, how it works, saves back, end card) and product scenes over the replica.
- `src/lib/replica.tsx`: a scene's story is a list of beats. Each beat resets the replica's stores, applies every beat so far, and replays clicks on a fresh mount for menus that live in component state, so any frame renders the same in any order.
- `src/lib/product-stage.tsx` and `camera.ts`: the replica in a lifted card, with a camera that frames targets and a cursor that clicks them. Targets are measured once per beat on mount, before the first frame is captured.
- CSS transitions and keyframes inside the replica are switched off (`src/theme.css`); every motion comes from the frame number.

## Brand and logo notes

- Look: the site's sage stage, Inter at 450 with tight tracking, and brand-green emphasis.
- The Planning Center Services mark is shown unaltered, in full color on a light background, with clear space of at least its height. It is never locked up with the PCOBooster rocket or set inside a phrase ([Planning Center's logo rules](https://www.planningcenter.com/logos)).
- The end card carries the "not affiliated with, sponsored by, or endorsed by Planning Center" note and "Sample data shown"; every person and song is the replica's fictional sample.
- SongSelect and ChordPro appear by name only, as the import menu lists them. Add their marks only with permission.

## Voiceover

Captions are burned in as the headlines. The voiceover script, timed to each cut, is in [`VOICEOVER.md`](VOICEOVER.md). To add a recording, drop it in `public/` and add an `<Audio>` to `Cut` in `src/cuts.tsx`, then retime scene durations to the takes.
