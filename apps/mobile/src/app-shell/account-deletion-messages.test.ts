import { TransportFailure } from "@pcobooster/client/product-client";
import { Unauthenticated } from "@pcobooster/contracts/faults/unauthenticated";
import { describe, expect, it } from "vitest";

import { AccountDeletedWithLeftoversError } from "../session/account-deleted-with-leftovers";
import { accountDeletionFailureMessage } from "./account-deletion-messages";

describe(accountDeletionFailureMessage, () => {
  it("never says the account still exists when the answer could have been lost", () => {
    expect({
      keychain: accountDeletionFailureMessage(
        new AccountDeletedWithLeftoversError(["keychain", "cache"])
      ),
      cache: accountDeletionFailureMessage(
        new AccountDeletedWithLeftoversError(["cache"])
      ),
      signedOut: accountDeletionFailureMessage(
        new Unauthenticated({ message: "Sign in required" })
      ),
      offline: accountDeletionFailureMessage(
        new TransportFailure({
          procedure: "user.delete",
          reason: "network",
          cause: new TypeError("Network request failed"),
        })
      ),
    }).toStrictEqual({
      keychain:
        "Your account was deleted, but this iPhone couldn't remove its saved sign-in. If the account appears again, remove it from this iPhone, or delete the app.",
      cache:
        "Your account was deleted, but this iPhone couldn't clear some saved data for it. Deleting the app removes it.",
      signedOut:
        "This iPhone's sign-in for the account no longer works, so the deletion couldn't be confirmed. If you already deleted the account, remove it from this iPhone. Otherwise, sign in again and retry.",
      offline:
        "Couldn't reach pcobooster.com, so the deletion may not have finished. Try again. If it already went through, you'll be asked to sign in.",
    });
  });
});
