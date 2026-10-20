# Native app sign-in

A native app (the Expo app; the Swift app that first used this flow is gone) signs in with the same Planning Center OAuth flow as the web, run inside the system's web authentication session (`ASWebAuthenticationSession` on iOS), and then holds a Better Auth session as a bearer token instead of a cookie. The web sign-in is unchanged: a callback that a native start did not begin never takes the native path.

Code: `packages/api/src/auth/native-sign-in.ts` (start, exchange, callback hook), `packages/api/src/auth/bearer-sessions.ts` (bearer tokens), `packages/api/src/auth/planning-center-session.ts` and `packages/api/src/auth/demo-access.ts` (request headers), and `apps/server/src/http-app.ts` (rate limit).

## Flow

```text
App                          ASWebAuthenticationSession           pcobooster.com                    Planning Center
 |- PKCE: verifier v, challenge c = base64url(SHA-256(v)), random state s
 |- open /api/auth/native/start?code_challenge=c&code_challenge_method=S256&state=s&redirect_uri=pcobooster://auth/callback
 |                              |- GET start ------------------------>|
 |                              |<- 302 Planning Center authorize URL; Set-Cookie: OAuth state, signed marker {c, s, redirect_uri, OAuth state}
 |                              |- login (prompt=login; the server's own PKCE with Planning Center) ------------------>|
 |                              |<- 302 /api/auth/callback/planning-center?code&state ---------------------------------|
 |                              |- GET callback (state + marker) ---->| session created; marker matches this flow's state
 |                              |                                     | store handoff sha256(code) -> {session, c}, 2 minutes
 |                              |<- 302 pcobooster://auth/callback?code=<code>&state=s (no session cookies)
 |<- callback URL --------------|
 |- check state == s
 |- POST /api/auth/native/exchange {code, codeVerifier: v} (JSON, no cookies) ->| consume code once, check S256(v) == c
 |<- 200 {token, user, selectedAccountId} ------------------------------------|
 |- every request: Authorization: Bearer <token>, x-pcobooster-account: <selectedAccountId>
```

The OAuth start must run in the browser that receives the callback, because Better Auth checks a signed state cookie there. Only the single-use code crosses the custom scheme; the session token travels only in the exchange's TLS response body.

## HTTP contract

All paths are on the product origin: `https://pcobooster.com` in production, `http://127.0.0.1:3001` with `bun run dev:auth` locally.

### Start: `GET /api/auth/native/start`

Opened in an `ASWebAuthenticationSession` (prefer `prefersEphemeralWebBrowserSession = true`), with the callback scheme of the chosen redirect URI.

| Query parameter | Rule |
| --- | --- |
| `redirect_uri` | Exactly one of `NATIVE_REDIRECT_URIS`: `pcobooster://auth/callback` (release builds) or `pcobooster-dev://auth/callback` (debug builds). Compared as an exact string. |
| `code_challenge` | `base64url(SHA-256(code_verifier))` without padding: exactly 43 characters of `[A-Za-z0-9_-]`. |
| `code_challenge_method` | `S256`. No other method is accepted. |
| `state` | Opaque to the server and echoed back unchanged: 16 to 256 characters of `[A-Za-z0-9._~-]`. Use at least 32 random bytes, base64url. |

Responses:

- `302` to Planning Center, with two `HttpOnly; SameSite=Lax` cookies (`Secure` and `__Secure-` prefixed on https): Better Auth's OAuth state cookie (`Path=/`, 5 minutes) and the signed native marker `better-auth.native_sign_in` (`Path=/api/auth`, 10 minutes). The marker records the challenge, the app's state, the redirect URI, and the flow's own OAuth state.
- `302` to `<redirect_uri>?error=invalid_request&state=<state>` when the redirect URI is valid but the challenge, method, or state is missing, repeated, or malformed. The state is echoed only when it is itself valid. No cookies are set.
- `400` JSON `{"code": "INVALID_REDIRECT_URI", "message": ...}` when `redirect_uri` is missing, repeated, or not in the allowlist. The server never redirects to a URI outside the allowlist.
- `429` JSON `{"error": "Too many requests"}` with `Retry-After: 60` past the auth rate limit.

### Callback result: `<redirect_uri>?...`

Planning Center returns to the registered web callback, `/api/auth/callback/planning-center`. When that callback carries a valid marker for its own OAuth state, the browser is sent to the app instead of the web:

- Success: `<redirect_uri>?code=<code>&state=<state>`. The code is 43 base64url characters, single use, valid for 2 minutes (`NATIVE_HANDOFF_TTL_SECONDS`), stored only as its SHA-256 hash, and bound to the start's PKCE challenge.
- Failure: `<redirect_uri>?error=<code>&state=<state>`, with a code from the native error vocabulary below.

Either way the marker is expired, and the callback response sets none of the session cookies a web callback would (session token, session cache, device account, selected organization), so a shared browser keeps whatever web session it already had. The app must reject a callback whose `state` differs from the one it sent, and ignore any `pcobooster://auth/...` URL that arrives outside an active sign-in.

### Exchange: `POST /api/auth/native/exchange`

Headers: `Content-Type: application/json`, and no `Cookie` header (Better Auth answers `403` to a cookie-bearing POST without a trusted `Origin`). Body:

```json
{
  "code": "<code from the callback>",
  "codeVerifier": "<the PKCE verifier, 43 to 128 of [A-Za-z0-9._~-]>"
}
```

`200` (with `Cache-Control: no-store`, no cookies):

```json
{
  "token": "<session token>.<signature>",
  "user": { "id": "...", "name": "...", "email": "...", "image": null },
  "selectedAccountId": "<account row id, or null>"
}
```

- `token` is the Better Auth session token with its HMAC signature, the same value the web keeps in its session cookie. Store it in the Keychain and send it as `Authorization: Bearer <token>`.
- `selectedAccountId` is the Planning Center organization (account row) this sign-in used, the one the web would select. Send it as `x-pcobooster-account`.

`400` JSON errors:

| `code` | When |
| --- | --- |
| `INVALID_REQUEST` | The body is not `{code, codeVerifier}` in the formats above. |
| `INVALID_GRANT` | The code is unknown, already used, or expired; the verifier does not match the challenge; or the session ended before the exchange. These cases are deliberately indistinguishable. Start a new sign-in. |

A code is consumed by its first exchange attempt, including one with the wrong verifier, which also deletes the session created for it. Concurrent exchanges of one code cannot both succeed.

### Authenticated requests

| Header | Value | Read by |
| --- | --- | --- |
| `Authorization` | `Bearer <token>` | Better Auth's `bearer` plugin, before every Better Auth endpoint and every `auth.api.*` call, so the product API (`/api/v1`) and `/api/auth/*` both accept it |
| `x-pcobooster-account` | An account row id from `accounts.list` | `getSelectedPlanningCenterAccountId`, before the `pco-selected-account-id` cookie |
| `x-pcobooster-demo` | The demo token from `demo.start`'s `Set-Cookie: pcobooster-demo=<token>` | `resolveDemoSession`, before the `pcobooster-demo` cookie |

- Only the signed `token.signature` form authenticates (`requireSignature: true`). A raw session token, which appears in D1 and some JSON responses, does not.
- The account header is validated like the cookie: it only chooses among the signed-in user's own linked accounts. An unknown or foreign id falls back to the first linked account, and `accounts.list` reports the account actually used in `selectedAccountId`. To switch organizations, call `accounts.select` (it validates the id) and send the new id; ignore its `Set-Cookie`.
- The demo header is validated exactly like the cookie: it must match the token derived from the current `DEMO_ACCESS_KEY`.
- Use a cookieless `URLSession` (`httpCookieStorage = nil`, `httpShouldSetCookies = false`, `httpCookieAcceptPolicy = .never`). Cookies on a POST to `/api/auth/*` cause `403 MISSING_OR_NULL_ORIGIN`, and a stale session cache cookie could identify the wrong user.
- Sessions last 7 days, extended at most once a day while used; the token does not change when it is extended. An expired or revoked token makes every procedure fail with `Unauthenticated` (401) and `session.status` report `{authenticated: false}`: sign in again.

### Sign-out

`POST /api/auth/sign-out` with `Authorization: Bearer <token>`, `Content-Type: application/json`, body `{}`, and no cookies. Better Auth deletes the session, so the token stops working at once (bearer clients have no session cache to outlive it). Then delete the token from the Keychain.

### Account deletion

`DELETE /api/v1/user` (`api.user.delete()`) with `Authorization: Bearer <token>` deletes the token's own pcobooster.com account. It takes no input; the user is always the session's. The API reads the session from D1 (never the cookie cache), refuses the demo and the local API's sign-in with `Forbidden` (403) and a missing or unsigned token with `Unauthenticated` (401), then deletes in one D1 batch: the user, every session and linked account (with its Planning Center tokens), their account identities, feedback, activity events, and unredeemed native handoffs (`packages/api/src/modules/account-deletion/delete-account-data.ts`). The same batch queues a PostHog erasure for the user id in `analytics_erasure_requests`; it is carried out later, in two passes, by `bun run analytics:erase` (see [analytics](analytics.md#erasing-deleted-accounts)). Nothing in Planning Center changes. A browser caller's session cookies are expired; another browser's signed session cache can still describe the user for up to five minutes, so feedback reads its session from D1 and inserts only while the user row exists. Bearer tokens have no cache, so other phones lose access at once. The app captures the account and token before the call, sends only that token, then forgets the person on the device like a removal (Keychain entry and cached reads), without a revoke. If the server fails, nothing on the device changes. Once it has deleted, the person leaves the running app at once; a Keychain write that fails twice, or cached reads that could not be cleared, are reported as `AccountDeletedWithLeftoversError` with what is left, never as a clean deletion. A lost answer (network or `Unauthenticated`) is reported as unconfirmed, never as "not deleted".

## Native error vocabulary

`error` values on the app redirect (`nativeSignInErrorCodes`). Better Auth's own codes are folded into this fixed list, so new upstream codes arrive as `server_error`.

| `error` | Meaning | Suggested copy (from the web's sign-in errors) |
| --- | --- | --- |
| `invalid_request` | The start parameters were missing or malformed. A client bug. | Something went wrong signing in with Planning Center. Please try again. |
| `access_denied` | The person declined or cancelled at Planning Center. | Planning Center access wasn't granted. Try again when you're ready. |
| `sign_in_expired` | The browser flow expired or lost its cookies (`state_mismatch`, `state_not_found`, `please_restart_the_process`). | That sign-in link expired. Please start again. |
| `email_not_found` | The Planning Center profile has no email address. | Your Planning Center profile needs an email address to sign in. |
| `profile_unavailable` | Planning Center's profile could not be read. | We couldn't read your Planning Center profile. Please try again. |
| `account_not_linked` | This organization could not be added to the account. | We couldn't add this Planning Center organization to your account. Please try again. |
| `account_linked_elsewhere` | This Planning Center login already belongs to a different pcobooster.com account. | This Planning Center login is already connected to a different pcobooster.com account. |
| `server_error` | Anything else. | Something went wrong signing in with Planning Center. Please try again. |

Failed native callbacks are still recorded as `auth_sign_in_failed` activity events with Better Auth's original code, exactly like web ones.

## Security properties

- **No open redirects.** The redirect URI is compared exactly against `NATIVE_REDIRECT_URIS`; anything else gets a `400` in the browser. `pcobooster://` is never added to Better Auth's `trustedOrigins`.
- **Tokens stay out of URLs.** Only the one-time code is in a URL. Neither the code nor tokens are logged; the plugin logs only user ids and rejection reasons.
- **PKCE S256 only.** The code is bound to the app's challenge and compared in constant time (fixed-length digests). A stolen code is useless without the verifier.
- **Flow binding.** The marker is signed with the auth secret and names the OAuth state of the flow that set it, so an abandoned native start cannot redirect a later web sign-in in the same browser, and a code is minted only by the callback that created a session for that native flow. There is no endpoint that turns an existing session into a code.
- **HttpOnly still holds on the web.** The stock bearer plugin's response hook, which copies every new session cookie into a `set-auth-token` header that page scripts can read, is removed. A regression test checks that web callbacks and session refreshes carry no `set-auth-token`.
- **Known limit of custom schemes.** Another app can register the same scheme. PKCE protects flows the real app starts, but someone who starts a flow themselves and convinces a victim to complete the Planning Center login (which always asks for credentials, `prompt=login`) could receive the victim's code on a device where a malicious app owns the scheme. The upgrade path is an HTTPS callback through Associated Domains (`ASWebAuthenticationSession.Callback.https`).

## Rate limits

The API Worker's per-IP auth limit (`AUTH_RATE_LIMIT`, 30 requests a minute per `cf-connecting-ip`, counted per Cloudflare location) covers every `POST /api/auth/*`, which includes the exchange and sign-out, and `GET /api/auth/native/start`, which writes an OAuth state row. OAuth callbacks and session reads are not limited. Over the limit the Worker answers `429 {"error": "Too many requests"}` with `Retry-After: 60` before Better Auth runs.

## Where it works

- **Production** (`https://pcobooster.com`) and **local real OAuth** (`bun run dev:auth`, main checkout, `http://127.0.0.1:3001`): Planning Center only redirects to those registered callbacks. Locally the cookies are unprefixed and not `Secure`, which `ASWebAuthenticationSession` accepts on http loopback.
- **`bun run dev`** (personal access token): every request is already signed in as the token's owner, so the simulator can call `/api/v1` with no token. Native sign-in still needs `dev:auth`.
- **Previews and staging** sit behind Cloudflare Access and broker OAuth through production; native sign-in is not supported there.

## Rollback

Revert the pull request that added native sign-in and redeploy. The web flow does not depend on any of it: the native endpoints and bearer support disappear, native tokens stop authenticating (their sessions remain valid for the web's cookie path only, which no browser holds), and native apps fall back to their sign-in screen. No migration or setting is involved; handoff codes live in Better Auth's `verification` table and expire within two minutes.
