/**
 * Cookies a procedure sets on its HTTP response. Handlers call `ResponseCookies` (provided by
 * ProcedureScope); the route writes each one as its own `Set-Cookie` line, beside whatever the
 * response already carries.
 */
import { PLANNING_CENTER_SELECTED_ACCOUNT_COOKIE } from "@pcobooster/api/auth/planning-center-session";
import { Server } from "@pcobooster/api/server";
import { DEMO_SESSION_COOKIE } from "@pcobooster/contracts/demo";
import { Context, Duration, Effect } from "effect";
import * as Cookies from "effect/http/Cookies";

export class ResponseCookies extends Context.Service<
  ResponseCookies,
  { readonly set: (cookie: Cookies.Cookie) => void }
>()("@pcobooster/api/ResponseCookies") {}

const SESSION_COOKIE_MAX_AGE = Duration.days(30);

/**
 * A session cookie as the previous transport wrote it: HttpOnly, SameSite=Lax, the whole site,
 * 30 days (or expired now for null), and Secure everywhere except plain-HTTP local development.
 */
const sessionCookie = (
  name: string,
  value: string | null,
  secure: boolean
): Cookies.Cookie =>
  // The names are constants and the value is URI-encoded, so the cookie is always valid.
  Cookies.makeCookieUnsafe(name, value ?? "", {
    httpOnly: true,
    sameSite: "lax",
    maxAge: value === null ? Duration.zero : SESSION_COOKIE_MAX_AGE,
    path: "/",
    secure,
  });

export const selectedAccountCookie = (
  accountId: string,
  secure: boolean
): Cookies.Cookie =>
  sessionCookie(PLANNING_CENTER_SELECTED_ACCOUNT_COOKIE, accountId, secure);

/** A null token expires the demo session cookie. */
export const demoSessionCookie = (
  sessionToken: string | null,
  secure: boolean
): Cookies.Cookie => sessionCookie(DEMO_SESSION_COOKIE, sessionToken, secure);

/** Expires a cookie set for the whole site. */
export const expiredCookie = (name: string, secure: boolean): Cookies.Cookie =>
  sessionCookie(name, null, secure);

/** Sets the cookie `make` builds for this stage on the procedure's response. */
export const setResponseCookie = (
  make: (secure: boolean) => Cookies.Cookie
): Effect.Effect<void, never, ResponseCookies | Server> =>
  Effect.gen(function* setCookie() {
    const { config } = yield* Server;
    const cookies = yield* ResponseCookies;
    cookies.set(make(!config.localDevelopment));
  });
