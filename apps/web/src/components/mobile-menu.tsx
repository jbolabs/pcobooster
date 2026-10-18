import { useRender } from "@base-ui/react/use-render";
import {
  BubbleChatEditIcon,
  HelpCircleIcon,
  LaptopIcon,
  Logout01Icon,
  UserSwitchIcon,
  Moon02Icon,
  ShieldUserIcon,
  Sun01Icon,
} from "@hugeicons/core-free-icons";
import { getInitials } from "@pcobooster/planning-center-models/initials";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import {
  MobileMenuIcon,
  MobileMenuItem,
  MobileMenuOverlay,
  useMobileMenu,
} from "@pcobooster/ui/mobile-menu";
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { useEffect, useId, useState } from "react";

import { useAccessReview } from "@/components/access/access-review";
import { MobileFeedbackDialog } from "@/components/mobile-feedback-dialog";
import { useOnboarding } from "@/components/onboarding/onboarding-provider";
import { SidebarNavIcon } from "@/components/sidebar-nav-icon";
import { useTheme } from "@/components/theme-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { signOutLabel, useAccountPanel } from "@/hooks/use-account-panel";
import { useFeatureEnabled } from "@/hooks/use-feature-enabled";
import { getAppSection } from "@/lib/app-routes";
import { ReplayMask } from "@/lib/replay-mask";
import { cn } from "@/lib/utils";

const MOBILE_MENU_ID = "mobile-menu";

const themeOptions = [
  { value: "light", label: "Light", icon: Sun01Icon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
  { value: "system", label: "System", icon: LaptopIcon },
] as const;

/** A large menu link, set like the marketing menu. */
const MenuLink = ({
  link,
  label,
  active,
}: {
  /** A router `<Link>`; the entry renders through it. */
  link: ReactElement;
  label: string;
  active: boolean;
}) =>
  useRender({
    render: link,
    props: {
      "aria-current": active ? "page" : undefined,
      className: cn(
        "block py-2.5 text-4xl tracking-tight outline-none select-none focus-visible:underline",
        active
          ? "text-foreground"
          : "text-muted-foreground active:text-foreground"
      ),
      children: label,
    },
  });

interface MenuEntry {
  key: string;
  link: ReactElement;
  label: string;
  active: boolean;
}

/** The sections this account can open; plan views live in the plan header. */
const useMenuEntries = (): MenuEntry[] => {
  const pathname = useLocation({ select: (location) => location.pathname });
  const section = getAppSection(pathname);
  const peopleEnabled = useFeatureEnabled("people");
  const songsEnabled = useFeatureEnabled("chordCharts");
  const entries: MenuEntry[] = [
    {
      key: "services",
      link: <Link to="/services" />,
      label: "Services",
      active: section === "services",
    },
  ];
  if (peopleEnabled) {
    entries.push({
      key: "people",
      link: <Link to="/people" />,
      label: "People",
      active: section === "people",
    });
  }
  if (songsEnabled) {
    entries.push({
      key: "songs",
      link: <Link to="/songs" />,
      label: "Songs",
      active: section === "songs",
    });
  }
  return entries;
};

const MenuNav = ({
  entries,
  itemCount,
}: {
  entries: MenuEntry[];
  itemCount: number;
}) => (
  <ul>
    {entries.map((entry, index) => (
      <MobileMenuItem key={entry.key} index={index} count={itemCount}>
        <MenuLink link={entry.link} label={entry.label} active={entry.active} />
      </MobileMenuItem>
    ))}
  </ul>
);

/** A quiet account row; `render` is a bare `<button />`. */
const AccountRow = ({
  render,
  children,
  ...props
}: {
  render: ReactElement;
  children: ReactNode;
} & Pick<ComponentProps<"button">, "disabled" | "onClick">) =>
  useRender({
    render,
    props: {
      ...props,
      className:
        "focus-visible:ring-ring/50 text-muted-foreground active:text-foreground flex h-11 w-full items-center gap-3 rounded-lg text-left text-base outline-none focus-visible:ring-2 disabled:opacity-50",
      children,
    },
  });

/** Theme, getting started, sign out, and the profile row; feedback, access, and switch account unless demo. */
const accountItemCount = (demo: boolean): number => (demo ? 4 : 7);

const MenuAccount = ({
  panel,
  startIndex,
  itemCount,
  onClose,
  onOpenFeedback,
}: {
  panel: ReturnType<typeof useAccountPanel>;
  /** The menu position of the first account row, after the nav links. */
  startIndex: number;
  itemCount: number;
  onClose: () => void;
  onOpenFeedback: () => void;
}) => {
  const { setTheme, theme } = useTheme();
  const {
    data,
    demo,
    summary,
    panelError,
    isSigningOut,
    signOut,
    switchAccount,
  } = panel;
  const { openReview, restricted } = useAccessReview();
  const { openWelcome } = useOnboarding();
  const themeOption =
    themeOptions.find((option) => option.value === theme) ?? themeOptions[2];
  const themeSelectId = useId();
  // Rows roll in order after the nav links; hidden rows take no slot.
  const guideIndex = startIndex + 1;
  const feedbackIndex = startIndex + 2;
  const accessIndex = startIndex + 3;
  const signOutIndex = startIndex + (demo ? 2 : 5);
  const row = (index: number, children: ReactNode) => (
    <MobileMenuItem as="div" index={index} count={itemCount}>
      {children}
    </MobileMenuItem>
  );

  return (
    <div className="flex flex-col gap-1">
      {row(
        startIndex,
        <div className="text-muted-foreground flex h-11 items-center gap-3 text-base">
          <SidebarNavIcon icon={themeOption.icon} />
          <label htmlFor={themeSelectId} className="flex-1">
            Theme
          </label>
          <NativeSelect
            id={themeSelectId}
            value={themeOption.value}
            onChange={(event) => {
              const option = themeOptions.find(
                (candidate) => candidate.value === event.target.value
              );
              if (option) {
                setTheme(option.value);
              }
            }}
          >
            {themeOptions.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}
      {row(
        guideIndex,
        <AccountRow
          render={<button type="button" aria-label="Getting started" />}
          onClick={() => {
            onClose();
            openWelcome();
          }}
        >
          <SidebarNavIcon icon={HelpCircleIcon} />
          Getting started
        </AccountRow>
      )}
      {demo
        ? null
        : row(
            feedbackIndex,
            <AccountRow
              render={<button type="button" aria-label="Feedback" />}
              onClick={() => {
                onClose();
                onOpenFeedback();
              }}
            >
              <SidebarNavIcon icon={BubbleChatEditIcon} />
              Feedback
            </AccountRow>
          )}
      {demo
        ? null
        : row(
            accessIndex,
            <AccountRow
              render={<button type="button" aria-label="Your access" />}
              onClick={() => {
                onClose();
                openReview();
              }}
            >
              <SidebarNavIcon icon={ShieldUserIcon} />
              <span className="flex-1">Your access</span>
              {restricted ? (
                <span className="text-status-scheduled text-sm">Limited</span>
              ) : null}
            </AccountRow>
          )}
      {demo
        ? null
        : row(
            accessIndex + 1,
            <AccountRow
              render={<button type="button" aria-label="Switch account" />}
              disabled={isSigningOut}
              onClick={() => {
                void switchAccount();
              }}
            >
              <SidebarNavIcon icon={UserSwitchIcon} />
              Switch account
            </AccountRow>
          )}
      {row(
        signOutIndex,
        <>
          <AccountRow
            render={
              <button
                type="button"
                aria-label={signOutLabel(demo, isSigningOut)}
              />
            }
            disabled={isSigningOut}
            onClick={() => {
              void signOut();
            }}
          >
            {isSigningOut ? (
              <Spinner />
            ) : (
              <SidebarNavIcon icon={Logout01Icon} />
            )}
            {signOutLabel(demo, isSigningOut)}
          </AccountRow>
          {panelError ? (
            <p className="text-destructive text-sm">{panelError}</p>
          ) : null}
        </>
      )}
      {row(
        signOutIndex + 1,
        <div className="border-border/50 mt-3 flex items-center gap-3 border-t pt-4">
          {summary === null ? (
            <>
              <Skeleton variant="round" className="size-9 shrink-0" />
              <div className="flex min-w-0 flex-col gap-1.5">
                <Skeleton variant="text" className="h-4 w-32" />
                <Skeleton variant="text" className="h-3 w-24" />
              </div>
            </>
          ) : (
            <>
              <Avatar className="size-9">
                {isNonEmptyString(summary.image) ? (
                  <AvatarImage src={summary.image} alt="" />
                ) : null}
                {summary.avatarName === null ? null : (
                  <AvatarFallback>
                    {getInitials(summary.avatarName)}
                  </AvatarFallback>
                )}
              </Avatar>
              <div className="min-w-0">
                <ReplayMask className="truncate text-sm font-medium">
                  {data?.session.name ?? summary.avatarName}
                </ReplayMask>
                <p className="text-muted-foreground truncate text-xs">
                  {demo ? "Read-only demo" : summary.organizationName}
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * The phone header: a pinned bar with the menu button on the right and the
 * shared full-screen menu (`@pcobooster/ui/mobile-menu`) beneath it. The bar
 * covers content scrolling under it with a solid background; the header itself
 * stays filter-free so the fixed overlay is not trapped. `className` places the header (for example,
 * `-mx-4` inside padded pages); `subbar` is a second pinned row under the bar,
 * such as plan view tabs, hidden while the menu is open.
 */
export const MobileHeader = ({
  className,
  subbar,
  children,
}: {
  className?: string;
  subbar?: ReactNode;
  children: ReactNode;
}) => {
  const menu = useMobileMenu();
  const entries = useMenuEntries();
  const accountPanel = useAccountPanel();
  const itemCount = entries.length + accountItemCount(accountPanel.demo);
  const router = useRouter();
  const { handleClose } = menu;
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(
    () => router.subscribe("onBeforeNavigate", handleClose),
    [router, handleClose]
  );

  return (
    <header
      data-open={menu.open ? "" : undefined}
      className={cn(
        "group/menu pt-safe sticky top-0 z-30 shrink-0 md:hidden",
        className
      )}
    >
      {/*
       * The background sits on an absolute layer, not the sticky header: Safari 26
       * tints its bars from sticky elements' own backgrounds, while this layer
       * lets the header show through the status bar like the page beneath.
       */}
      <div
        aria-hidden
        className="bg-background absolute inset-0 group-data-open/menu:hidden"
      />
      <div className="relative z-10 flex h-14 items-center gap-1 px-4">
        {/*
         * Fades with the overlay through the container's own opacity: hiding
         * with `visibility` lets children with `transition-all` (buttons)
         * animate it and linger after the menu opens.
         */}
        <div
          inert={menu.open}
          className="flex min-w-0 flex-1 items-center gap-1 transition-opacity duration-150 ease-(--ease-snappy) group-data-open/menu:opacity-0"
        >
          {children}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={menu.open ? "Close menu" : "Open menu"}
          aria-expanded={menu.open}
          aria-controls={MOBILE_MENU_ID}
          data-tour="mobile-menu"
          className="-mr-2 shrink-0"
          onClick={menu.handleToggle}
        >
          <MobileMenuIcon open={menu.open} />
        </Button>
      </div>
      {subbar === undefined ? null : (
        <div
          inert={menu.open}
          className="relative z-10 transition-opacity duration-150 ease-(--ease-snappy) group-data-open/menu:opacity-0"
        >
          {subbar}
        </div>
      )}
      <MobileMenuOverlay
        id={MOBILE_MENU_ID}
        open={menu.open}
        className="pt-safe"
      >
        <nav
          aria-label="Mobile navigation"
          className="pb-safe-4 flex h-full flex-col justify-between gap-8 overflow-y-auto overscroll-contain px-4 pt-18"
        >
          <MenuNav entries={entries} itemCount={itemCount} />
          <MenuAccount
            panel={accountPanel}
            startIndex={entries.length}
            itemCount={itemCount}
            onClose={menu.handleClose}
            onOpenFeedback={() => {
              setFeedbackOpen(true);
            }}
          />
        </nav>
      </MobileMenuOverlay>
      <MobileFeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
      />
    </header>
  );
};
