/** Account deletion was asked for outside a signed-in account (the demo, or the local API). */
export class AccountDeletionUnavailableError extends Error {
  constructor() {
    super("Only a signed-in account can be deleted.");
    this.name = "AccountDeletionUnavailableError";
  }
}
