# Plan file previews

Researched October 5, 2026 against official Services documentation and Agape Church's existing plan `78289 / 89633542`. No service, song, arrangement, key, or attachment content was created or edited. Discovery used GET; explicit file opens used Services' documented read action, which records an attachment-open activity.

## Discovery and access

A plan exposes `all_attachments`, including inherited song, arrangement, and key files as well as plan, item, media, and service-type attachments. Its filters can restrict attachable types or file extensions. Prefer this paginated collection to per-song fan-out; attachment relationships identify the owning resource and can be matched to each item's song, arrangement, and key. The item `attachments` collection provides the provider-resolved files for that item. Sources: [Attachment API associations](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/attachment), [Item API](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/item).

`POST .../attachments/{id}/open` returns `AttachmentActivity.attachment_url`; `preview` similarly supplies a reduced-resolution file only when `has_preview` is true, otherwise 404. These actions are distinct from attachment create/update/delete. Source: [Attachment actions](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/attachment), [AttachmentActivity](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/attachment_activity).

The live plan-scoped `all_attachments/{id}/open` route worked for a generated chart, uploaded PDF, Word document, and MP3. Do not use the metadata `url` as file bytes: these samples pointed to the Services UI. S3 `remote_link` was a relative storage key, whereas YouTube's was an external HTTPS URL. Resolve the actual file on explicit user intent through the authenticated API; never accept an arbitrary browser-supplied upstream URL.

The existing `SongsService.openChartAttachment` marks the provider POST as `readAction: true`, allowing presentation-mode reads without enabling content writes. Reuse that convention for plan file opens. Do not add any service mutation to file browsing.

## Live response evidence

The plan returned **105 attachments**, requiring two pages at `per_page=100`. Treat pagination explicitly; a single page would silently omit files.

| Provider type | Count | Meaning / handling |
| --- | --: | --- |
| `AttachmentChart::Chord` | 5 | Generated chord PDF, selected key |
| `AttachmentChart::Lyric` | 4 | Generated lyric PDF |
| `AttachmentChartPro` | 4 | Imported chart; determine preview from filename/content type |
| `AttachmentS3` | 39 | 34 audio, 4 PDF, 1 legacy Word document |
| `AttachmentRehearsalMixV2` | 44 | Provider rehearsal mix; retain stream/download capabilities |
| `AttachmentYoutube` | 9 | Linked video |

All sampled generated charts had `content_type: null`, `filetype: music` or `lyric`, and `has_preview: false`, despite opening as real PDFs. Classify these exact chart types, then MIME type and filename extension. `has_preview` governs the provider's reduced-resolution action, not whether pcobooster.com can render the original. Uploaded MP3s reported `streamable` and `web_streamable` true. YouTube reported `web_streamable` true but `streamable` false. Honor `downloadable` and `allow_mp3_download` rather than promising every file can be downloaded.

For one song item, the item attachment collection returned 20 files owned by its selected Arrangement and Key. The all-plan collection's `relationships.attachable.data` uses the same owner IDs, so grouping can happen without additional per-song requests.

## Signed URLs, PDF loading, and redirects

Live generated chart opens returned an HTTPS AWS API Gateway URL with `X-Amz-Expires=60`; GET redirected to a temporary S3 PDF bucket. Uploaded files returned signed S3 URLs with variable lifetimes of roughly 21,000 seconds in these samples. These are observations, not a provider lifetime contract. Do not persist, log, publish in proof, or reuse these bearer URLs across accounts; open afresh and allow retry when loading fails.

A GET of each selected file returned 200 with `Access-Control-Allow-Origin: *` and `Accept-Ranges: bytes`. Generated PDF response disposition was inline, uploaded PDF/DOC/MP3 disposition attachment. Signed URLs must be tested with GET: HEAD yielded 403 for S3 and 404 for the chart-generation gateway because signatures/actions are method-specific. Bodies were canceled after response headers during research.

PDF.js supports URL and byte input, but remote URL loading depends on CORS. A same-origin authenticated bounded PDF byte fetch also avoids relying on every integration's CORS and keeps expiring upstream links out of persisted query data. If proxying, validate HTTPS and the provider host on **every redirect**, impose size/time bounds, and only fetch the URL obtained from the selected attachment's authenticated open action. Sources: [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html), [PDF.js FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions).

## Chord charts and document coverage

Services creates a chart for each arrangement key and transposes saved lyrics/chords into those keys; number and numeral charts must be enabled in Services. Viewing the selected plan key's generated attachment preserves Planning Center's formatting and licensing behavior without updating the arrangement. Sources: [Lyrics & Chords mobile editor](https://pcoservicesmobile.zendesk.com/hc/en-us/articles/360008614593-Lyrics-Chords-editor), [Lyrics & Chords editor](https://help.planningcenter.com/en/139440-use-the-lyrics---chords-editor.html).

Planning Center-created text documents and stage layouts are shared as PDFs, while uploaded Office documents can remain their original file types. The live legacy `.doc` had no provider preview and opened as `application/msword`; do not imply universal inline Office rendering. Offer the actual file when no safe browser preview exists. Avoid sending private signed URLs to third-party Office/Google viewers. Sources: [Create, upload, or link files](https://help.planningcenter.com/en/139415-create%2C-upload%2C-or-link-to-files.html), [Add files to a song](https://help.planningcenter.com/en/139434-add-files-to-a-song.html).

## Recommended interaction

These are product recommendations based on the evidence above:

- Place Files on the existing plan overview; group by service-order item, with plan/service-type resources in a clearly named group. Keep song title and selected key visible. Show type and file count so a musician can immediately find the chart or rehearsal audio.
- Desktop: a generous preview dialog with filename, item context, file navigation, and visible download/open actions. PDF uses the existing PDF.js rendering rather than relying on an iframe plugin. Audio uses native controls; images fit the viewer; video uses native controls when the resolved file is a playable media URL.
- Phone: use the screen for the document, a stable close control and compact header, and an independently scrolling file chooser. Fit PDF width initially, provide zoom/page controls, and preserve enough context to return to the plan. Avoid a tiny PDF inside a narrow side panel.
- Native media controls provide playback, seeking, and accessibility. Use `preload="metadata"`; start on a user action and avoid automatic playback. Use `playsInline` for video. Pause/unmount media when closing or switching files. Sources: [HTML audio](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/audio), [HTML video](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video).
- Show a truthful fallback for unsupported documents or linked providers: filename/type, explanation, and an action to open the actual file/provider. Safely recognized YouTube links can use a provider-specific embed; arbitrary webpages should not be embedded as trusted documents.
- Fetch metadata on screen intent and resolve only the selected file. PDF byte fetching adds an upstream subrequest, so account for it in the existing Workers request budget. Do not warm every audio/chart URL on overview load.

## Verification targets

Use the existing Agape plan without modifying it. Verify pagination includes the last page, a generated chart renders with its key, uploaded PDF rendering, MP3 play/pause/seek, linked video handling, and the legacy Word fallback. Exercise desktop and phone viewport, keyboard close/focus restoration, loading/error/retry, and signed URL expiry behavior. Public PR proof should use fictional/presentation data and must exclude credentials, signed URLs, and private file contents.

## Safari text extraction

iPhone Safari simulator verification exposed a PDF.js text-extraction failure: `getTextContent` uses `ReadableStream` async iteration, which Safari does not implement. Consume `streamTextContent()` with `getReader()` so the accessible page text works alongside canvas rendering. A regression test explicitly removes the async iterator. Sources: [PDF.js upstream report](https://github.com/mozilla/pdf.js/issues/21557), [PDFPageProxy API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html#streamTextContent).
