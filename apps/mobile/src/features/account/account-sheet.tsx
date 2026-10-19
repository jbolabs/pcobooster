import { Button, ContextMenu, Host, RNHostView } from "@expo/ui/swift-ui";
import { Stack, useRouter } from "expo-router";
import { Fragment, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SHEET_DISMISS_MS } from "../../app-shell/app-providers";
import {
  accountDisplayName,
  formatUsedAgo,
} from "../../app-shell/device-accounts";
import { sharedReads, useProductClient } from "../../app-shell/queries";
import { useSession } from "../../app-shell/session";
import { useVisibleQuery as useQuery } from "../../app-shell/visible-queries";
import { BottomActionBar } from "../../components/bottom-action-bar";
import { ConfirmationSheet } from "../../components/confirmation-sheet";
import { Glyph } from "../../components/glyph";
import { Hairline } from "../../components/hairline";
import { PersonAvatar } from "../../components/person-avatar";
import { RocketMark } from "../../components/rocket-mark";
import { SurfaceCard } from "../../components/surface-card";
import { AppText } from "../../design/app-text";
import { colors } from "../../design/colors";
import { Spacing } from "../../design/metrics";
import { useClock } from "../../lib/environment";
import { MAX_DEVICE_ACCOUNTS } from "../../session/device-session";
import type { DeviceAccount } from "../../session/device-session";
import type { AccountsListing } from "../../session/session-store";
import { AccountRow, AccountSection, AVATAR_LARGE } from "./account-rows";
import {
  AboutSection,
  AppearanceSection,
  FeedbackSection,
  PlanningCenterSection,
} from "./account-sections";

const destructiveRole = "destructive";
const LIST_TOP_MARGIN = 35;
const SECTION_GAP = 27;
const DEMO_MARK = 64;
const DEMO_ROCKET = 44;
/** Device rows inset their divider past the avatar. */
const ROW_DIVIDER_INSET = Spacing.lg + AVATAR_LARGE + Spacing.md;

const styles = StyleSheet.create({
  addCircle: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: AVATAR_LARGE / 2,
    height: AVATAR_LARGE,
    justifyContent: "center",
    width: AVATAR_LARGE,
  },
  // SwiftUI's inset grouped list: a taller top margin and more room between sections.
  content: {
    gap: SECTION_GAP,
    paddingHorizontal: Spacing.lg,
    paddingTop: LIST_TOP_MARGIN,
  },
  demoMark: {
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: DEMO_MARK / 2,
    height: DEMO_MARK,
    justifyContent: "center",
    width: DEMO_MARK,
  },
  deviceText: { flex: 1, gap: Spacing.xxs },
  identity: { alignItems: "center", flexDirection: "row", gap: Spacing.lg },
  identityPadding: { paddingVertical: Spacing.lg + 3 },
  identityText: { flex: 1, gap: Spacing.xxs },
  root: { backgroundColor: colors.surfaceCanvas, flex: 1 },
});

/** The bottom action's words, with the web's pending copy (`signOutLabel`). */
const signOutLabel = (demo: boolean, pending: boolean): string => {
  if (demo) {
    return pending ? "Leaving demo\u2026" : "Exit Demo";
  }
  return pending ? "Signing out\u2026" : "Sign Out";
};

/** Who is signed in: `accounts.list` once it answers, else the remembered account. */
const identityOf = (
  listed: AccountsListing | null,
  active: DeviceAccount | null
) => {
  const selected =
    listed?.accounts.find(
      (candidate) => candidate.id === listed.selectedAccountId
    ) ?? listed?.accounts[0];
  const email = listed?.session.email ?? active?.email ?? "";
  const listedName = listed?.session.name.trim() ?? "";
  const name =
    listedName || (active === null ? email : accountDisplayName(active));
  return {
    name,
    email,
    image: listed?.session.image ?? active?.image,
    organization:
      selected?.identity?.organizationName ?? active?.organizationName ?? null,
  };
};

const IdentityCard = () => {
  const session = useSession();
  const accounts = useQuery(sharedReads.accounts(useProductClient())).data;
  if (session.isDemo) {
    return (
      <SurfaceCard contentStyle={[styles.identity, styles.identityPadding]}>
        <View style={styles.demoMark}>
          <RocketMark size={DEMO_ROCKET} />
        </View>
        <View style={styles.identityText}>
          <AppText font="cardTitle">Read-only demo</AppText>
          <AppText color={colors.inkSecondary} font="rowDetail">
            Explore freely. Changes aren&apos;t saved.
          </AppText>
        </View>
      </SurfaceCard>
    );
  }
  const listed = accounts === undefined || accounts.demo ? null : accounts;
  const { name, email, image, organization } = identityOf(
    listed,
    session.active
  );
  if (name === "") {
    return null;
  }
  return (
    <SurfaceCard contentStyle={[styles.identity, styles.identityPadding]}>
      <PersonAvatar name={name} photoUrl={image} size="hero" />
      <View style={styles.identityText}>
        <AppText font="pageTitle" numberOfLines={2}>
          {name}
        </AppText>
        <AppText
          color={colors.inkSecondary}
          ellipsizeMode="middle"
          font="rowDetail"
          numberOfLines={1}
        >
          {email}
        </AppText>
        {organization === null ? null : (
          <AppText
            color={colors.inkSecondary}
            font="rowDetail"
            numberOfLines={2}
          >
            {organization}
          </AppText>
        )}
      </View>
    </SurfaceCard>
  );
};

const DeviceAccountRow = ({
  account,
  isActive,
  isPending,
  onSelect,
  onRemove,
}: {
  account: DeviceAccount;
  isActive: boolean;
  isPending: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) => {
  const now = useClock().now();
  const name = accountDisplayName(account);
  const detail = account.needsSignIn
    ? "Sign in again"
    : [
        account.organizationName,
        isActive ? null : formatUsedAgo(account.lastUsedAt, now),
      ]
        .filter((part) => part !== null)
        .join(" · ");
  let hint = "Switches to this account";
  if (isActive) {
    hint = "Signed in now";
  } else if (account.needsSignIn) {
    hint = "Signs in again with Planning Center";
  }
  const row = (
    <AccountRow
      accessibilityHint={hint}
      accessibilityLabel={`${name}, ${detail}`}
      onPress={isActive ? undefined : onSelect}
      selected={isActive}
      testID={`device-account-${account.userId}`}
    >
      <PersonAvatar name={name} photoUrl={account.image} size="large" />
      <View style={styles.deviceText}>
        <AppText font="rowTitle" numberOfLines={1}>
          {name}
        </AppText>
        {detail === "" ? null : (
          <AppText
            color={
              account.needsSignIn
                ? colors.statusPendingText
                : colors.inkSecondary
            }
            font="meta"
            numberOfLines={1}
          >
            {detail}
          </AppText>
        )}
      </View>
      {isPending ? <ActivityIndicator /> : null}
      {!isPending && isActive ? (
        <Glyph
          color={colors.ink}
          size={20}
          symbol="checkmark"
          weight="semibold"
        />
      ) : null}
    </AccountRow>
  );
  if (isActive) {
    return row;
  }
  return (
    <Host matchContents>
      <ContextMenu>
        <ContextMenu.Trigger>
          <RNHostView matchContents>{row}</RNHostView>
        </ContextMenu.Trigger>
        <ContextMenu.Items>
          <Button
            label="Switch to This Account"
            systemImage="arrow.left.arrow.right"
            onPress={onSelect}
          />
          <Button
            label="Remove from This Device"
            systemImage="person.badge.minus"
            role={destructiveRole}
            onPress={onRemove}
          />
        </ContextMenu.Items>
      </ContextMenu>
    </Host>
  );
};

/**
 * "On this device": tapping another person closes the sheet, then switches, so the app rebuilds
 * behind the sheet instead of under it. Long press another person for switching and removal actions. "Add another account" signs in with Planning Center.
 */
const DeviceAccounts = () => {
  const session = useSession();
  const router = useRouter();
  const [switchingUserId, setSwitchingUserId] = useState<string | null>(null);
  const activeUserId = session.active?.userId ?? null;
  const [removing, setRemoving] = useState<DeviceAccount | null>(null);
  const select = (account: DeviceAccount) => {
    if (switchingUserId !== null) {
      return;
    }
    if (account.needsSignIn) {
      void session.signIn({ resuming: account, addingAccount: true });
      return;
    }
    setSwitchingUserId(account.userId);
    router.back();
    setTimeout(() => {
      session.switchAccount(account.userId);
    }, SHEET_DISMISS_MS);
  };
  const isAddingAccount =
    session.signInActivity.kind === "authenticating" &&
    session.signInActivity.userId === null;
  let footer = "People you switch away from stay signed in on this device.";
  if (session.accounts.length === 0) {
    footer = "Signed in by the local API.";
  } else if (session.accounts.length >= MAX_DEVICE_ACCOUNTS) {
    footer = `This device remembers up to ${MAX_DEVICE_ACCOUNTS} accounts. Remove one to add another.`;
  }
  return (
    <>
      <AccountSection footer={footer} title="On this device">
        {session.accounts.map((account, index) => (
          <Fragment key={account.userId}>
            {index > 0 ? (
              <Hairline
                color={colors.hairlineSubtle}
                inset={ROW_DIVIDER_INSET}
                trailing={Spacing.lg}
              />
            ) : null}
            <DeviceAccountRow
              account={account}
              isActive={account.userId === activeUserId}
              isPending={
                switchingUserId === account.userId ||
                (session.signInActivity.kind === "authenticating" &&
                  session.signInActivity.userId === account.userId)
              }
              onRemove={() => {
                setRemoving(account);
              }}
              onSelect={() => {
                select(account);
              }}
            />
          </Fragment>
        ))}
        {session.accounts.length < MAX_DEVICE_ACCOUNTS ? (
          <>
            {session.accounts.length > 0 ? (
              <Hairline
                color={colors.hairlineSubtle}
                inset={ROW_DIVIDER_INSET}
                trailing={Spacing.lg}
              />
            ) : null}
            <AccountRow
              disabled={session.signInActivity.kind !== "idle"}
              onPress={() => {
                void session.signIn({ addingAccount: true });
              }}
              testID="add-account-button"
            >
              <View style={styles.addCircle}>
                <Glyph
                  color={colors.ink}
                  size={20}
                  symbol="add"
                  weight="medium"
                />
              </View>
              <AppText
                font="rowTitle"
                numberOfLines={1}
                style={styles.deviceText}
              >
                Add another account
              </AppText>
              {isAddingAccount ? <ActivityIndicator /> : null}
            </AccountRow>
          </>
        ) : null}
      </AccountSection>
      <ConfirmationSheet
        visible={removing !== null}
        title={`Remove ${removing === null ? "account" : accountDisplayName(removing)} from this device?`}
        message="You'll need to sign in with Planning Center to use this account here again."
        action="Remove"
        onCancel={() => {
          setRemoving(null);
        }}
        onConfirm={() => {
          if (removing !== null) {
            void session.forget(removing);
          }
          setRemoving(null);
        }}
      />
    </>
  );
};

/**
 * Deleting the signed-in person's pcobooster.com account (App Store guideline 5.1.1(v)): a
 * destructive row, then a confirmation that says exactly what goes and what stays. Only a real
 * signed-in account sees it; the demo and the local API's sign-in have nothing to delete.
 */
const DeleteAccountSection = () => {
  const session = useSession();
  const [confirming, setConfirming] = useState(false);
  if (session.phase.kind !== "signedIn") {
    return null;
  }
  return (
    <>
      <AccountSection footer="Deletes your account and what pcobooster.com keeps about you. Nothing in Planning Center changes.">
        <AccountRow
          accessibilityHint="Asks before permanently deleting your pcobooster.com account"
          disabled={session.isDeletingAccount}
          onPress={() => {
            setConfirming(true);
          }}
          testID="delete-account-row"
        >
          <AppText
            color={colors.destructive}
            font="rowTitle"
            style={styles.deviceText}
          >
            {session.isDeletingAccount
              ? "Deleting account\u2026"
              : "Delete Account"}
          </AppText>
          {session.isDeletingAccount ? <ActivityIndicator /> : null}
        </AccountRow>
      </AccountSection>
      <ConfirmationSheet
        visible={confirming}
        title="Delete your pcobooster.com account?"
        message={[
          "This permanently deletes your pcobooster.com account on every device: your profile, your linked Planning Center organizations and the sign-in tokens we stored for them, your sessions, the feedback you sent, and your activity history. It can't be undone.",
          "Nothing in Planning Center changes. Your church's people, plans, songs, and schedules stay exactly as they are.",
          "Deleting also requests erasure of the usage analytics, error reports, and session recordings sent to PostHog, our analytics provider. That erasure is processed separately and can take up to a few weeks to finish; you don't need to contact us. You can sign in with Planning Center again later as a new account.",
        ].join("\n\n")}
        action="Delete Account"
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          setConfirming(false);
          void session.deleteAccount();
        }}
      />
    </>
  );
};

/**
 * The account sheet (Swift `AccountSheet`), opened from the avatar on every tab root: who is
 * signed in, the people on this device, the Planning Center organization and "Your access",
 * appearance, feedback, account deletion, and about. Sign Out (or Exit Demo) is the full-width bottom action,
 * confirmed in an action sheet.
 */
export const AccountSheet = () => {
  const session = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isDemo } = session;
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  let signOutMessage =
    "This device forgets this account. You can sign in again with Planning Center anytime.";
  if (isDemo) {
    signOutMessage =
      "You'll go back to the sign-in screen, or to the account you were using.";
  } else if (session.accounts.length > 1) {
    signOutMessage =
      "This device forgets this account. Other remembered accounts stay signed in.";
  }
  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          unstable_headerRightItems: () => [
            {
              type: "button",
              label: "Close",
              accessibilityLabel: "Close",
              icon: { type: "sfSymbol", name: "xmark" },
              onPress: () => {
                router.back();
              },
            },
          ],
        }}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing.huge * 2 },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        testID="account-sheet"
      >
        <IdentityCard />
        {isDemo ? null : <DeviceAccounts />}
        {isDemo ? null : <PlanningCenterSection />}
        <AppearanceSection />
        {isDemo ? null : <FeedbackSection />}
        <DeleteAccountSection />
        <AboutSection />
      </ScrollView>
      <ConfirmationSheet
        visible={confirmingSignOut}
        title={isDemo ? "Exit the demo?" : "Sign out of pcobooster.com?"}
        message={signOutMessage}
        action={isDemo ? "Exit Demo" : "Sign Out"}
        onCancel={() => {
          setConfirmingSignOut(false);
        }}
        onConfirm={() => {
          setConfirmingSignOut(false);
          void session.signOut();
        }}
      />
      <BottomActionBar
        actions={[
          {
            title: signOutLabel(isDemo, session.isSigningOut),
            role: "destructive",
            isBusy: session.isSigningOut,
            onPress: () => {
              setConfirmingSignOut(true);
            },
            testID: "sign-out-button",
          },
        ]}
      />
    </View>
  );
};
