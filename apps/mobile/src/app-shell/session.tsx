import { createContext, useContext } from "react";

import type { DeviceAccount } from "../session/device-session";
import type { SessionPhase } from "../session/session-store";

/** Progress of a sign-in started from the sign-in screen or the account sheet. */
export type SignInActivity =
  | { readonly kind: "idle" }
  /** The Planning Center sheet is open, or the code is being exchanged. */
  | { readonly kind: "authenticating"; readonly userId: string | null }
  /** Signed in; the rocket launches away before the app appears. */
  | { readonly kind: "launching"; readonly userId: string | null };

/** Who is signed in on this device, and the session flows (Swift `AppModel`'s session part). */
export interface SessionValue {
  readonly phase: SessionPhase;
  /** People remembered on this device, most recent first. */
  readonly accounts: readonly DeviceAccount[];
  /** The active person: signed in, or whose session ended. Null in the demo and locally. */
  readonly active: DeviceAccount | null;
  /** The app's tabs show: signed in, the demo, or the local API's own sign-in. */
  readonly isSignedIn: boolean;
  readonly isDemo: boolean;
  /** Signed in by the local API (`bun run dev`), with no account on this device. */
  readonly isDevelopment: boolean;
  readonly signInActivity: SignInActivity;
  /** Sign-in error copy for the sign-in screen. */
  readonly signInMessage: string | null;
  readonly isSigningOut: boolean;
  /**
   * "Sign in with Planning Center", or resuming a person whose session ended. From the account
   * sheet (`addingAccount`), errors toast and the new person becomes active directly.
   */
  readonly signIn: (options?: {
    readonly resuming?: DeviceAccount;
    readonly addingAccount?: boolean;
  }) => Promise<void>;
  /** Continues as a remembered person: locally, or through Planning Center if their session ended. */
  readonly continueAs: (account: DeviceAccount) => void;
  /** Makes another remembered person active (no server call). */
  readonly switchAccount: (userId: string) => void;
  /** Forgets a person on this device and revokes their session. */
  readonly forget: (account: DeviceAccount) => Promise<void>;
  readonly isDeletingAccount: boolean;
  /**
   * Deletes the active person's pcobooster.com account, then forgets them on this device.
   * Failures toast and leave everything as it was; resolves whether it was deleted.
   */
  readonly deleteAccount: () => Promise<boolean>;
  /** Signs out of this device, or leaves the demo. */
  readonly signOut: () => Promise<void>;
  /** Switches to another of the person's Planning Center organizations. */
  readonly switchOrganization: (accountId: string) => Promise<void>;
  /** Starts the read-only demo; throws the reason it could not. */
  readonly startDemo: (key: string) => Promise<void>;
}

export const SessionContext = createContext<SessionValue | null>(null);

export const useSession = (): SessionValue => {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error("useSession needs an AppProviders above it");
  }
  return value;
};
