/** What this device could not clear after the server deleted the account. */
export type DeletionLeftover = "keychain" | "cache";

/**
 * The server deleted the account, but this device could not clear everything it kept for it.
 * The person is already gone from the running app; what failed is listed so the message can say
 * exactly what is left and how to clear it.
 */
export class AccountDeletedWithLeftoversError extends Error {
  readonly leftovers: readonly DeletionLeftover[];

  constructor(leftovers: readonly DeletionLeftover[]) {
    super(
      leftovers.includes("keychain")
        ? "Your account was deleted, but this iPhone couldn't remove its saved sign-in. If the account appears again, remove it from this iPhone, or delete the app."
        : "Your account was deleted, but this iPhone couldn't clear some saved data for it. Deleting the app removes it."
    );
    this.name = "AccountDeletedWithLeftoversError";
    this.leftovers = leftovers;
  }
}
