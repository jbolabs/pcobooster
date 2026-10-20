import { AccountDeletedWithLeftoversError } from "./account-deleted-with-leftovers";
import type { DeletionLeftover } from "./account-deleted-with-leftovers";
import { AccountDeletionUnavailableError } from "./account-deletion-unavailable";
import type { CredentialStore } from "./credential-store";
/**
 * Who the app is signed in as, kept in the Keychain, and the credentials every request carries
 * (Swift `SessionStore`). An external store for `useSyncExternalStore`: every change publishes a
 * new snapshot.
 *
 * - Several people can be remembered (up to four); one is active. Switching is local.
 * - Each person has a selected Planning Center account, sent as `x-pcobooster-account`.
 * - A demo session takes precedence while it lasts.
 * - An `Unauthenticated` answer for the active token marks that person `needsSignIn`.
 */
import {
  activateAccount,
  activeAccount,
  emptySession,
  removeAccount,
  updateAccount,
  upsertAccount,
} from "./device-session";
import type {
  DemoCredential,
  DeviceAccount,
  StoredSession,
} from "./device-session";
import type { NativeSignInResult } from "./native-sign-in";

export type SessionPhase =
  /** The Keychain has not been read yet, or the development check is running. */
  | { readonly kind: "launching" }
  | { readonly kind: "signedOut" }
  | { readonly kind: "signedIn"; readonly account: DeviceAccount }
  /** The active person's session ended: the sign-in screen names them. */
  | { readonly kind: "needsSignIn"; readonly account: DeviceAccount }
  | { readonly kind: "demo"; readonly demo: DemoCredential }
  /** Local `bun run dev`: the API signs every request in with its personal access token. */
  | { readonly kind: "development" };

/** What one request is authenticated with. */
export interface RequestCredentials {
  readonly bearerToken: string | null;
  readonly accountId: string | null;
  readonly demoToken: string | null;
}

export const noCredentials: RequestCredentials = {
  bearerToken: null,
  accountId: null,
  demoToken: null,
};

/** The HTTP headers credentials become. Never a cookie. */
export const credentialHeaders = (credentials: RequestCredentials) => {
  const headers: Record<string, string> = {};
  if (credentials.bearerToken !== null) {
    headers.authorization = `Bearer ${credentials.bearerToken}`;
  }
  if (credentials.accountId !== null) {
    headers["x-pcobooster-account"] = credentials.accountId;
  }
  if (credentials.demoToken !== null) {
    headers["x-pcobooster-demo"] = credentials.demoToken;
  }
  return headers;
};

/** The `accounts.list` fields the session keeps in step with. */
export interface AccountsListing {
  readonly demo: boolean;
  readonly session: {
    readonly userId: string;
    readonly name: string;
    readonly email: string;
    readonly image: string | null;
  };
  readonly selectedAccountId: string | null;
  readonly accounts: readonly {
    readonly id: string;
    readonly identity: { readonly organizationName: string | null } | null;
  }[];
}

/** The API calls the session makes itself, through the app's product client. */
export interface SessionApi {
  /** `accounts.select`; resolves with the account the server selected. */
  readonly selectAccount: (accountId: string) => Promise<string | null>;
  /** `demo.start`; resolves with the demo token from its `Set-Cookie`. */
  readonly startDemo: (key: string) => Promise<string>;
  readonly exitDemo: () => Promise<void>;
  /** `session.status` with no credentials: does the API sign requests in on its own? */
  readonly isSignedInWithoutCredentials: () => Promise<boolean>;
  /**
   * `user.delete`, sent with exactly this bearer token and no demo credential: deletes that
   * token's own pcobooster.com account. Throws the API's fault.
   */
  readonly deleteAccount: (bearerToken: string) => Promise<void>;
}

export interface SessionStoreDependencies {
  readonly store: CredentialStore;
  readonly api: SessionApi;
  /** Revokes a session this device no longer holds (`POST /api/auth/sign-out`). */
  readonly revoke: (token: string) => Promise<void>;
  readonly now: () => Date;
  readonly credentialIdentity: (token: string) => Promise<string>;
  /** Called with people this device forgot, so their cached reads go too. */
  readonly beforeRestore?: () => Promise<void>;
  /**
   * Clears what the device keeps for people it forgot (cached reads, previews). Resolves once
   * cleared; a rejection means something stayed behind.
   */
  readonly onForget?: (userIds: readonly string[]) => Promise<void>;
  /** Failures nobody needs to see (a revoke, a Keychain write); logged by the caller. */
  readonly onBackgroundFailure?: (error: Error) => void;
}

export interface SessionSnapshot {
  readonly phase: SessionPhase;
  readonly stored: StoredSession;
  /**
   * The account context reads belong to: one person and organization, the demo, or the local
   * API. Caches are partitioned by it, so nothing crosses accounts.
   */
  readonly scope: string;
  readonly persisted: boolean;
}

const scopeOf = (phase: SessionPhase, identity: string): string => {
  switch (phase.kind) {
    case "signedIn":
    case "needsSignIn": {
      return `user:${phase.account.userId}:${phase.account.selectedAccountId ?? "default"}:${identity}`;
    }
    case "demo": {
      return `demo:${identity}`;
    }
    case "development": {
      return "development";
    }
    case "launching":
    case "signedOut": {
      return phase.kind;
    }
    default: {
      throw new Error("Unknown session phase");
    }
  }
};

const profileChanged = (
  before: DeviceAccount | null,
  after: DeviceAccount | null
): boolean =>
  before?.name !== after?.name ||
  before?.email !== after?.email ||
  before?.image !== after?.image ||
  before?.selectedAccountId !== after?.selectedAccountId ||
  before?.organizationName !== after?.organizationName;

export class SessionStore {
  private readonly identities = new Map<string, string>();
  private stored: StoredSession = emptySession;
  private restored = false;
  private restoring: Promise<void> | null = null;
  private readonly memoryIdentities = new Map<string, string>();
  private development = false;
  private checkingDevelopment = false;
  private snapshot: SessionSnapshot;
  private readonly listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  private readonly dependencies: SessionStoreDependencies;

  constructor(dependencies: SessionStoreDependencies) {
    this.dependencies = dependencies;
    this.snapshot = this.makeSnapshot();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): SessionSnapshot => this.snapshot;

  /** The credentials a request sent now carries. */
  readonly credentials = (): RequestCredentials => {
    const { phase } = this.snapshot;
    if (phase.kind === "signedIn") {
      return {
        bearerToken: phase.account.token,
        accountId: phase.account.selectedAccountId,
        demoToken: null,
      };
    }
    if (phase.kind === "demo") {
      return { ...noCredentials, demoToken: phase.demo.token };
    }
    return noCredentials;
  };

  /** Reads the Keychain once at launch. */
  readonly restore = async (): Promise<void> => {
    if (this.restored) {
      return;
    }
    this.restoring ??= this.loadSession();
    await this.restoring;
  };

  private async loadSession(): Promise<void> {
    await this.dependencies.beforeRestore?.();
    let loaded = emptySession;
    try {
      loaded = await this.dependencies.store.load();
    } catch (error) {
      this.dependencies.onBackgroundFailure?.(
        error instanceof Error ? error : new Error("Session storage failed")
      );
    }
    await Promise.all(
      [
        ...loaded.accounts.map((account) => account.token),
        ...(loaded.demo === null ? [] : [loaded.demo.token]),
      ].map(async (token) => {
        this.identities.set(
          token,
          await this.dependencies.credentialIdentity(token)
        );
      })
    );
    this.restored = true;
    this.apply(loaded, { persist: false });
  }

  /** Starts in a known session without the Keychain (the fixture harness). */
  readonly seed = (session: StoredSession): void => {
    this.restored = true;
    this.apply(session, { persist: false });
  };

  /**
   * With nobody signed in, asks whether the API signs requests in on its own (local
   * `bun run dev`), and if so enters the development phase. Development builds against a local
   * API only.
   */
  readonly checkDevelopmentBypass = async (): Promise<void> => {
    if (this.snapshot.phase.kind !== "signedOut") {
      return;
    }
    this.checkingDevelopment = true;
    this.publish();
    let signedIn = false;
    try {
      signedIn = await this.dependencies.api.isSignedInWithoutCredentials();
    } catch {
      signedIn = false;
    }
    this.checkingDevelopment = false;
    this.development = signedIn && activeAccount(this.stored) === null;
    this.publish();
  };

  /**
   * Saves a completed sign-in and makes that person active. Signing in again as a remembered
   * person replaces their token (the old session is revoked); a fifth person drops the least
   * recently used one (also revoked). Ends a demo and the development phase.
   */
  readonly completeSignIn = async (result: NativeSignInResult) => {
    await this.restore();
    this.identities.set(
      result.token,
      await this.dependencies.credentialIdentity(result.token)
    );
    const existing = this.stored.accounts.find(
      (account) => account.userId === result.user.id
    );
    const selected =
      result.selectedAccountId ?? existing?.selectedAccountId ?? null;
    const account: DeviceAccount = {
      userId: result.user.id,
      name: result.user.name,
      email: result.user.email,
      image: result.user.image ?? null,
      token: result.token,
      selectedAccountId: selected,
      organizationName:
        existing !== undefined && selected === existing.selectedAccountId
          ? existing.organizationName
          : null,
      lastUsedAt: this.dependencies.now(),
      needsSignIn: false,
    };
    const { session, dropped } = upsertAccount(
      { ...this.stored, demo: null },
      account
    );
    const revoked = dropped.map((entry) => entry.token);
    // Started before the new session applies, so the old token's cache writes are dropped first.
    const forgetting =
      existing !== undefined && existing.token !== result.token
        ? this.forgetLocally([existing.userId])
        : Promise.resolve(true);
    if (existing !== undefined && existing.token !== result.token) {
      revoked.push(existing.token);
    }
    this.development = false;
    this.apply({ ...session, activeUserId: account.userId });
    await Promise.all([
      forgetting,
      dropped.length > 0
        ? this.forgetLocally(dropped.map((entry) => entry.userId))
        : true,
      this.revoke(revoked),
    ]);
  };

  /** Makes a remembered person active, without a server call. */
  readonly switchAccount = (userId: string): void => {
    this.apply(activateAccount(this.stored, userId, this.dependencies.now()));
  };

  /** Forgets a remembered person on this device and revokes their session. */
  readonly remove = async (userId: string): Promise<void> => {
    const { session, removed } = removeAccount(this.stored, userId);
    if (removed === null) {
      return;
    }
    this.apply(session);
    await Promise.all([
      this.forgetLocally([userId]),
      this.revoke([removed.token]),
    ]);
  };

  /**
   * Deletes the active person's pcobooster.com account on the server, then forgets them here
   * like a removal: their Keychain entry and cached reads go, and in-flight cache writes for
   * them are dropped. The server already ended every session, so nothing is revoked.
   *
   * The person and token are captured before the call, so switching people while it runs still
   * deletes and forgets the right one. If the server fails, nothing local changes and its fault
   * is thrown (an `Unauthenticated` answer marks the person `needsSignIn` through the client, as
   * for any call). Once the server has deleted, the person leaves memory at once; a Keychain
   * write is tried twice, and anything still left behind is thrown as
   * `AccountDeletedWithLeftoversError`, never reported as a clean deletion.
   */
  readonly deleteAccount = async (): Promise<void> => {
    const { phase } = this.snapshot;
    if (phase.kind !== "signedIn") {
      throw new AccountDeletionUnavailableError();
    }
    const { userId, token } = phase.account;
    await this.dependencies.api.deleteAccount(token);
    const leftovers: DeletionLeftover[] = [];
    const forgetting = this.forgetLocally([userId]);
    const { session, removed } = removeAccount(this.stored, userId);
    if (removed !== null) {
      this.stored = session;
      this.publish();
      // The retry saves whatever is current then, which still lacks this person.
      const saved =
        (await this.save(session)) || (await this.save(this.stored));
      if (!saved) {
        leftovers.push("keychain");
      }
    }
    if (!(await forgetting)) {
      leftovers.push("cache");
    }
    if (leftovers.length > 0) {
      throw new AccountDeletedWithLeftoversError(leftovers);
    }
  };

  /** Signs the active person out of this device, or ends the demo or development phase. */
  readonly signOut = async (): Promise<void> => {
    const { phase } = this.snapshot;
    switch (phase.kind) {
      case "demo": {
        await this.exitDemo();
        return;
      }
      case "development": {
        this.development = false;
        this.publish();
        return;
      }
      case "signedIn":
      case "needsSignIn": {
        await this.remove(phase.account.userId);
        break;
      }
      case "launching":
      case "signedOut": {
        break;
      }
      default: {
        throw new Error("Unknown session phase");
      }
    }
  };

  /**
   * Switches the active person to another of their Planning Center accounts through
   * `accounts.select`, which checks the account is theirs. Throws the API's fault.
   */
  readonly switchOrganization = async (accountId: string): Promise<void> => {
    const { phase } = this.snapshot;
    if (phase.kind !== "signedIn") {
      return;
    }
    const selected = await this.dependencies.api.selectAccount(accountId);
    const { phase: after } = this.snapshot;
    if (
      after.kind !== "signedIn" ||
      after.account.userId !== phase.account.userId
    ) {
      return;
    }
    this.apply(
      updateAccount(this.stored, phase.account.userId, (account) => ({
        ...account,
        selectedAccountId: selected ?? accountId,
        organizationName: null,
      }))
    );
  };

  /**
   * Keeps the active person's profile and organization in step with `accounts.list`. The server
   * reports the account it actually used (the first linked one when the sent id is unknown).
   */
  readonly refreshFromAccounts = (listing: AccountsListing): void => {
    const { phase } = this.snapshot;
    if (
      listing.demo ||
      phase.kind !== "signedIn" ||
      phase.account.userId !== listing.session.userId
    ) {
      return;
    }
    const selected =
      listing.selectedAccountId ?? phase.account.selectedAccountId;
    const organization =
      listing.accounts.find((entry) => entry.id === selected)?.identity
        ?.organizationName ?? null;
    const next = updateAccount(
      this.stored,
      phase.account.userId,
      (account) => ({
        ...account,
        name: listing.session.name,
        email: listing.session.email,
        image: listing.session.image,
        selectedAccountId: selected,
        organizationName: organization ?? account.organizationName,
      })
    );
    const before = activeAccount(this.stored);
    const after = activeAccount(next);
    const changed = profileChanged(before, after);
    if (changed) {
      this.apply(next);
    }
  };

  /** Starts the read-only demo from a demo link key. Throws the API's fault. */
  readonly startDemo = async (key: string): Promise<void> => {
    await this.restore();
    const token = await this.dependencies.api.startDemo(key);
    this.identities.set(
      token,
      await this.dependencies.credentialIdentity(token)
    );
    this.apply({
      ...this.stored,
      demo: { token, startedAt: this.dependencies.now() },
    });
  };

  /** Ends the demo and returns to the remembered person, if any. */
  readonly exitDemo = async (): Promise<void> => {
    if (this.stored.demo === null) {
      return;
    }
    try {
      await this.dependencies.api.exitDemo();
    } catch (error) {
      this.dependencies.onBackgroundFailure?.(
        error instanceof Error ? error : new Error("Session storage failed")
      );
    }
    this.apply({ ...this.stored, demo: null });
  };

  /**
   * An `Unauthenticated` answer to a request sent with `sent`. Only the credentials still in use
   * end anything: an answer for an account the person already left changes nothing.
   */
  readonly handleUnauthorized = (sent: RequestCredentials): void => {
    const { phase } = this.snapshot;
    if (
      phase.kind === "signedIn" &&
      sent.demoToken === null &&
      sent.bearerToken === phase.account.token
    ) {
      this.apply(
        updateAccount(this.stored, phase.account.userId, (account) => ({
          ...account,
          needsSignIn: true,
        }))
      );
      return;
    }
    if (phase.kind === "demo" && sent.demoToken === phase.demo.token) {
      this.apply({ ...this.stored, demo: null });
      return;
    }
    if (
      phase.kind === "development" &&
      sent.bearerToken === null &&
      sent.demoToken === null
    ) {
      this.development = false;
      this.publish();
    }
  };

  /** Resolves once every Keychain write so far has finished (tests). */
  readonly flush = async (): Promise<void> => {
    await this.writes;
  };

  private derivePhase(): SessionPhase {
    if (!this.restored || this.checkingDevelopment) {
      return { kind: "launching" };
    }
    if (this.stored.demo !== null) {
      return { kind: "demo", demo: this.stored.demo };
    }
    const account = activeAccount(this.stored);
    if (account !== null) {
      return account.needsSignIn
        ? { kind: "needsSignIn", account }
        : { kind: "signedIn", account };
    }
    return this.development ? { kind: "development" } : { kind: "signedOut" };
  }

  private makeSnapshot(): SessionSnapshot {
    const phase = this.derivePhase();
    let token = "";
    if (phase.kind === "demo") {
      ({ token } = phase.demo);
    } else if (phase.kind === "signedIn" || phase.kind === "needsSignIn") {
      ({ token } = phase.account);
    }
    const identity = this.identities.get(token);
    let memoryIdentity = this.memoryIdentities.get(token);
    if (memoryIdentity === undefined) {
      memoryIdentity = `memory:${this.memoryIdentities.size}`;
      this.memoryIdentities.set(token, memoryIdentity);
    }
    return {
      phase,
      stored: this.stored,
      scope: scopeOf(phase, identity ?? memoryIdentity),
      persisted: phase.kind === "development" || identity !== undefined,
    };
  }

  private publish(): void {
    this.snapshot = this.makeSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private apply(
    next: StoredSession,
    { persist = true }: { readonly persist?: boolean } = {}
  ): void {
    this.stored = next;
    this.publish();
    if (persist) {
      void this.save(next);
    }
  }

  /**
   * Queues a Keychain write after every earlier one, so a slow earlier save never overwrites a
   * later change. Resolves whether it was saved; a failure is reported, never thrown.
   */
  private async save(next: StoredSession): Promise<boolean> {
    const previous = this.writes;
    const saved = (async () => {
      await previous;
      try {
        await this.dependencies.store.save(next);
        return true;
      } catch (error) {
        this.dependencies.onBackgroundFailure?.(
          error instanceof Error ? error : new Error("Session storage failed")
        );
        return false;
      }
    })();
    this.writes = (async () => {
      await saved;
    })();
    return await saved;
  }

  /** Clears forgotten people's device data; resolves whether it all went. Failures are reported. */
  private async forgetLocally(userIds: readonly string[]): Promise<boolean> {
    try {
      await this.dependencies.onForget?.(userIds);
      return true;
    } catch (error) {
      this.dependencies.onBackgroundFailure?.(
        error instanceof Error ? error : new Error("Forgetting failed")
      );
      return false;
    }
  }

  /** Failures are reported, never shown: the session ages out after 7 days regardless. */
  private async revoke(tokens: readonly string[]): Promise<void> {
    await Promise.all(
      tokens.map(async (token) => {
        try {
          await this.dependencies.revoke(token);
        } catch (error) {
          this.dependencies.onBackgroundFailure?.(
            error instanceof Error ? error : new Error("Session storage failed")
          );
        }
      })
    );
  }
}
