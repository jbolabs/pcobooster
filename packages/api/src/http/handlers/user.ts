import { deleteOwnAccount } from "@pcobooster/api/application/account-deletion";
import { DEVICE_COOKIE_MARKER } from "@pcobooster/api/auth/device-accounts";
import { PLANNING_CENTER_SELECTED_ACCOUNT_COOKIE } from "@pcobooster/api/auth/planning-center-session";
import {
  expiredCookie,
  setResponseCookie,
} from "@pcobooster/api/http/response-cookies";
import { Server } from "@pcobooster/api/server";
import { ProductApi } from "@pcobooster/contracts/http/api";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

export const UserHandlers = HttpApiBuilder.group(
  ProductApi,
  "user",
  (handlers) =>
    handlers.handle("delete", () =>
      Effect.gen(function* deleteUser() {
        const { userId } = yield* deleteOwnAccount();
        // A browser caller also drops its cookies, including the signed session cache that would
        // otherwise keep describing the deleted user until it expires. Native callers send none.
        const { auth } = yield* Server;
        const { sessionToken, sessionData, dontRememberToken } =
          (yield* Effect.promise(async () => await auth.$context)).authCookies;
        for (const name of [
          sessionToken.name,
          sessionData.name,
          dontRememberToken.name,
          `${sessionToken.name}${DEVICE_COOKIE_MARKER}${userId}`,
          PLANNING_CENTER_SELECTED_ACCOUNT_COOKIE,
        ]) {
          yield* setResponseCookie((secure) => expiredCookie(name, secure));
        }
        return { deleted: true as const };
      })
    )
);
