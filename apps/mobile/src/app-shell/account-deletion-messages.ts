import { TransportFailure } from "@pcobooster/client/product-client";
import { Unauthenticated } from "@pcobooster/contracts/faults/unauthenticated";

import { AccountDeletedWithLeftoversError } from "../session/account-deleted-with-leftovers";
import { failureMessage } from "./queries";

/**
 * What to tell someone whose Delete Account did not finish cleanly. A lost answer can hide a
 * deletion that went through, so those messages never claim the account still exists.
 */
export const accountDeletionFailureMessage = (error: Error): string => {
  if (error instanceof AccountDeletedWithLeftoversError) {
    return error.message;
  }
  if (error instanceof Unauthenticated) {
    return "This iPhone's sign-in for the account no longer works, so the deletion couldn't be confirmed. If you already deleted the account, remove it from this iPhone. Otherwise, sign in again and retry.";
  }
  if (error instanceof TransportFailure && error.reason === "network") {
    return "Couldn't reach pcobooster.com, so the deletion may not have finished. Try again. If it already went through, you'll be asked to sign in.";
  }
  return failureMessage(error);
};
