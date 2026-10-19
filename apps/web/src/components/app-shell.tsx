import {
  ArrowDown01Icon,
  Calendar04Icon,
  HelpCircleIcon,
  ListMusicIcon,
  KeyboardIcon,
  LaptopIcon,
  Logout01Icon,
  UserSwitchIcon,
  Moon02Icon,
  MusicNote03Icon,
  Settings02Icon,
  ShieldUserIcon,
  Sun01Icon,
  UsersIcon,
} from "@hugeicons/core-free-icons";
import { getInitials } from "@pcobooster/planning-center-models/initials";
import { isNonEmptyString } from "@pcobooster/planning-center-models/json";
import type { PlanView } from "@pcobooster/planning-center-models/plan-overview";
import { useHotkey } from "@tanstack/react-hotkeys";
import type { RegisterableHotkey } from "@tanstack/react-hotkeys";
import { Link, getRouteApi, useLocation } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useId, useState } from "react";

import { NoServicesAccess } from "@/components/access/access-notices";
import {
  AccessReviewProvider,
  useAccessReview,
} from "@/components/access/access-review";
import { HotkeyChord } from "@/components/hotkey-chord";
import { MobileHeader } from "@/components/mobile-menu";
import {
  OnboardingProvider,
  useOnboarding,
} from "@/components/onboarding/onboarding-provider";
import { planViewIcons } from "@/components/plan-view-icons";
import { SidebarBrandMark } from "@/components/sidebar-brand-mark";
import { SidebarChromeTrigger } from "@/components/sidebar-chrome-trigger";
import { SidebarFeedback } from "@/components/sidebar-feedback";
import { SidebarNavIcon } from "@/components/sidebar-nav-icon";
import type { SidebarTabGroupItem } from "@/components/sidebar-tab-group";
import { SidebarTabGroup } from "@/components/sidebar-tab-group";
import { SidebarToggleHotkey } from "@/components/sidebar-toggle-hotkey";
import { useTheme } from "@/components/theme-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverLabel } from "@/components/ui/hover-card";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  signOutLabel,
  useAccountPanel,
  useAccountsQuery,
} from "@/hooks/use-account-panel";
import { useSongTitle } from "@/hooks/use-chord-chart-song";
import { useFeatureEnabled } from "@/hooks/use-feature-enabled";
import { usePersonName } from "@/hooks/use-people-dashboard-person";
import { usePlanRoute } from "@/hooks/use-plan-route";
import { useEnabledPlanViews } from "@/hooks/use-plan-views";
import {
  APP_SHORTCUTS,
  PLAN_BUILDER_SHORTCUTS,
  FILE_DIALOG_SHORTCUTS,
  PRACTICE_SHORTCUTS,
  SHORTCUTS_PALETTE_HOTKEY,
} from "@/lib/app-hotkeys";
import type { DetailRoute } from "@/lib/app-routes";
import {
  getAppSection,
  getAppSectionLabel,
  getPlanViewLabel,
  parseDetailRoute,
  planViews,
} from "@/lib/app-routes";
import { presentationMode } from "@/lib/build-settings";
import { ReplayMask } from "@/lib/replay-mask";
import { cn } from "@/lib/utils";

const APP_CHROME_ROW = "flex h-12 shrink-0 items-center gap-2";
const APP_CHROME_HEADER_CLASS = cn(APP_CHROME_ROW, "px-2");

const themeOptions = [
  { value: "light", label: "Light", icon: Sun01Icon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
  { value: "system", label: "System", icon: LaptopIcon },
] as const;

type ServicesSidebarKey = "services" | PlanView;

const AppInsetChromeHeader = ({ children }: { children: ReactNode }) => {
  const { open, isMobile } = useSidebar();
  const alignWithPageContent = open && !isMobile;

  return (
    <header
      className={cn(
        APP_CHROME_ROW,
        "border-border/50 border-b max-md:hidden",
        alignWithPageContent ? "px-3 sm:px-4" : "px-2"
      )}
    >
      {children}
    </header>
  );
};

const usePathname = (): string =>
  useLocation({ select: (location) => location.pathname });

const headerTabClass = (active: boolean) =>
  cn(
    "hover:bg-accent/60 relative flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm",
    active
      ? "text-foreground font-semibold"
      : "text-muted-foreground hover:text-foreground"
  );

const PlanViewTabs = () => {
  const planRoute = usePlanRoute();
  const views = useEnabledPlanViews(planViews);
  if (planRoute === null) {
    return null;
  }
  return (
    <nav
      aria-label="Plan views"
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto overscroll-x-contain"
    >
      {views.map((view) => {
        const active = planRoute.view === view;
        return (
          <Link
            key={view}
            to="/services/$serviceTypeId/plans/$planId/$view"
            params={{ ...planRoute, view }}
            search
            replace
            aria-current={active ? "page" : undefined}
            data-tour={`plan-view-${view}`}
            className={headerTabClass(active)}
          >
            <SidebarNavIcon icon={planViewIcons[view]} className="size-4" />
            {/* The hidden bold copy reserves the active width so tabs don't shift. */}
            <span className="grid grid-cols-[max-content]">
              <span
                aria-hidden
                className="invisible col-start-1 row-start-1 font-semibold"
              >
                {getPlanViewLabel(view)}
              </span>
              <span className="col-start-1 row-start-1 text-center">
                {getPlanViewLabel(view)}
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
};

/** A detail page's breadcrumb: the person's name or the song's title once it is known. */
const DetailBreadcrumbLabel = ({ detail }: { detail: DetailRoute }) => {
  const personName = usePersonName(detail.personId);
  const songTitle = useSongTitle(detail.songId);
  return (
    <span className="block max-w-56 truncate">
      {personName === null ? (
        (songTitle ?? detail.label)
      ) : (
        <ReplayMask>{personName}</ReplayMask>
      )}
    </span>
  );
};

const AppTopBar = () => {
  const pathname = usePathname();
  const planRoute = usePlanRoute();
  const detail = parseDetailRoute(pathname);
  const pageLabel = getAppSectionLabel(getAppSection(pathname));

  if (planRoute !== null) {
    return (
      <div className="flex w-full min-w-0 items-center gap-1">
        <Link to="/services" className={headerTabClass(false)}>
          <ChevronLeft className="size-4" aria-hidden />
          <span>Services</span>
        </Link>
        <span aria-hidden className="bg-border mx-1 h-4 w-px shrink-0" />
        <PlanViewTabs />
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-2 sm:gap-3">
      <Breadcrumb className="shrink-0">
        <BreadcrumbList>
          {detail ? (
            <>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link to={detail.parentHref} />}>
                  {detail.parentLabel}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              {detail.songSubpage === null ? (
                <BreadcrumbItem>
                  <BreadcrumbPage>
                    <DetailBreadcrumbLabel detail={detail} />
                  </BreadcrumbPage>
                </BreadcrumbItem>
              ) : (
                <>
                  <BreadcrumbItem>
                    <BreadcrumbLink
                      render={
                        <Link
                          to="/songs/$songId"
                          params={{ songId: detail.songSubpage.songId }}
                          search={(previous) => previous}
                        />
                      }
                    >
                      <DetailBreadcrumbLabel detail={detail} />
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{detail.songSubpage.label}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              )}
            </>
          ) : (
            <BreadcrumbItem>
              <BreadcrumbPage>{pageLabel}</BreadcrumbPage>
            </BreadcrumbItem>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
};

const SidebarAccountPanel = ({
  onOpenShortcuts,
}: {
  onOpenShortcuts: () => void;
}) => {
  const { setTheme, theme } = useTheme();
  const currentTheme =
    themeOptions.find((option) => option.value === theme) ?? themeOptions[2];
  const themeSelectId = useId();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const { openReview, restricted } = useAccessReview();
  const { openWelcome, startPlanTour } = useOnboarding();
  const planRoute = usePlanRoute();
  const {
    data,
    demo,
    summary,
    panelError,
    isSigningOut,
    signOut,
    switchAccount,
  } = useAccountPanel();

  return (
    <SidebarMenu>
      <SidebarMenuItem data-tour="account-menu">
        <DropdownMenu
          open={accountMenuOpen}
          onOpenChange={(open) => {
            setAccountMenuOpen(open);
          }}
        >
          <DropdownMenuTrigger render={<SidebarMenuButton />}>
            {summary === null ? (
              <>
                <Skeleton variant="round" className="size-6 shrink-0" />
                <Skeleton variant="text" className="h-4 flex-1" />
              </>
            ) : (
              <>
                <Avatar size="sm">
                  {isNonEmptyString(summary.image) ? (
                    <AvatarImage src={summary.image} alt="" />
                  ) : null}
                  {summary.avatarName === null ? null : (
                    <AvatarFallback>
                      {getInitials(summary.avatarName)}
                    </AvatarFallback>
                  )}
                </Avatar>
                <span className="flex-1 truncate text-left text-sm font-medium">
                  {summary.organizationName ?? summary.avatarName}
                </span>
              </>
            )}
            <SidebarNavIcon
              icon={ArrowDown01Icon}
              className={cn(
                "text-muted-foreground ml-auto size-3.5 transition-transform group-data-[collapsible=icon]:hidden",
                accountMenuOpen ? "rotate-180" : null
              )}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="start"
            className="z-[80] w-[var(--radix-dropdown-menu-trigger-width)] max-w-none min-w-[14rem]"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="cursor-default">
                {data === null ? (
                  <>
                    <Skeleton variant="text" className="h-4 w-32" />
                    <Skeleton variant="text" className="mt-1.5 h-3 w-40" />
                  </>
                ) : (
                  <>
                    <ReplayMask className="text-foreground block truncate text-sm font-semibold">
                      {data.session.name}
                    </ReplayMask>
                    {demo ? (
                      <span className="text-muted-foreground mt-1 block truncate text-xs">
                        Read-only demo
                      </span>
                    ) : (
                      <ReplayMask className="text-muted-foreground mt-1 block truncate text-xs">
                        {data.session.email}
                      </ReplayMask>
                    )}
                  </>
                )}
              </DropdownMenuLabel>
            </DropdownMenuGroup>

            <DropdownMenuSeparator inset />

            <DropdownMenuGroup>
              <div className="flex items-center gap-2 px-2 py-1">
                <SidebarNavIcon
                  icon={currentTheme.icon}
                  className="text-muted-foreground"
                />
                <label
                  htmlFor={themeSelectId}
                  className="text-muted-foreground flex-1 text-sm"
                >
                  Appearance
                </label>
                <NativeSelect
                  id={themeSelectId}
                  size="sm"
                  value={currentTheme.value}
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
            </DropdownMenuGroup>

            <DropdownMenuSeparator inset />

            {demo ? null : (
              <DropdownMenuItem
                onSelect={() => {
                  openReview();
                }}
              >
                <SidebarNavIcon
                  icon={ShieldUserIcon}
                  className="text-muted-foreground"
                />
                <span className="flex-1">Your access</span>
                {restricted ? (
                  <span className="text-status-scheduled ml-2 text-xs">
                    Limited
                  </span>
                ) : null}
              </DropdownMenuItem>
            )}

            <DropdownMenuItem
              onSelect={() => {
                openWelcome();
              }}
            >
              <SidebarNavIcon
                icon={HelpCircleIcon}
                className="text-muted-foreground"
              />
              <span className="flex-1">Getting started</span>
            </DropdownMenuItem>

            {planRoute === null ? null : (
              <DropdownMenuItem
                onSelect={() => {
                  startPlanTour();
                }}
              >
                <SidebarNavIcon
                  icon={ListMusicIcon}
                  className="text-muted-foreground"
                />
                <span className="flex-1">Tour this plan</span>
              </DropdownMenuItem>
            )}

            <DropdownMenuItem
              onSelect={() => {
                onOpenShortcuts();
              }}
            >
              <SidebarNavIcon
                icon={KeyboardIcon}
                className="text-muted-foreground"
              />
              <span className="flex-1">Keyboard shortcuts</span>
              <HotkeyChord
                id="acct-menu-shortcuts"
                binding={SHORTCUTS_PALETTE_HOTKEY}
                className="ml-2 shrink-0"
              />
            </DropdownMenuItem>

            {panelError ? (
              <p className="text-destructive mx-2 my-1.5 text-xs leading-snug">
                {panelError}
              </p>
            ) : null}

            <DropdownMenuSeparator inset />

            {demo ? null : (
              <DropdownMenuItem
                disabled={isSigningOut}
                onSelect={() => {
                  void switchAccount();
                }}
              >
                <SidebarNavIcon icon={UserSwitchIcon} />
                Switch account
              </DropdownMenuItem>
            )}

            <DropdownMenuItem
              variant="destructive"
              disabled={isSigningOut}
              onSelect={() => {
                void signOut();
              }}
            >
              {isSigningOut ? (
                <Spinner />
              ) : (
                <SidebarNavIcon icon={Logout01Icon} />
              )}
              {signOutLabel(demo, isSigningOut)}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};

const servicesRootItem: SidebarTabGroupItem<ServicesSidebarKey> = {
  key: "services",
  label: "Services",
  link: <Link to="/services" />,
  icon: Calendar04Icon,
};

const ServicesSidebarMenuItem = () => {
  const pathname = usePathname();
  const planRoute = usePlanRoute();
  const views = useEnabledPlanViews(planViews);
  const servicesViewItems: SidebarTabGroupItem<ServicesSidebarKey>[] =
    planRoute === null
      ? [servicesRootItem]
      : [
          servicesRootItem,
          ...views.map((view) => ({
            key: view,
            label: getPlanViewLabel(view),
            // Keeps the selected slot across views.
            link: (
              <Link
                to="/services/$serviceTypeId/plans/$planId/$view"
                params={{ ...planRoute, view }}
                search
              />
            ),
            icon: planViewIcons[view],
          })),
        ];
  let servicesActiveKey: ServicesSidebarKey | null = null;
  if (pathname === "/services") {
    servicesActiveKey = "services";
  } else if (planRoute !== null) {
    servicesActiveKey = planRoute.view;
  }

  return (
    <SidebarTabGroup
      activeKey={servicesActiveKey}
      fallbackItem={servicesRootItem}
      isGrouped={planRoute !== null}
      items={servicesViewItems}
    />
  );
};

const useNavFeatures = () => ({
  peopleNavEnabled: useFeatureEnabled("people"),
  songsNavEnabled: useFeatureEnabled("chordCharts"),
});

const ShortcutList = ({
  shortcuts,
}: {
  shortcuts: readonly {
    id: string;
    label: string;
    binding: RegisterableHotkey;
  }[];
}) => (
  <dl className="grid grid-cols-1 gap-3 text-sm">
    {shortcuts.map((shortcut) => (
      <div
        key={shortcut.id}
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1"
      >
        <dt className="text-muted-foreground">{shortcut.label}</dt>
        <dd>
          <HotkeyChord id={shortcut.id} binding={shortcut.binding} />
        </dd>
      </div>
    ))}
  </dl>
);

const AppSidebar = ({
  peopleNavEnabled,
  songsNavEnabled,
}: {
  peopleNavEnabled: boolean;
  songsNavEnabled: boolean;
}) => {
  const pathname = usePathname();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const practiceEnabled = useFeatureEnabled("practice");

  useHotkey(
    SHORTCUTS_PALETTE_HOTKEY,
    () => {
      setShortcutsOpen(true);
    },
    { ignoreInputs: true }
  );

  return (
    <>
      <Sidebar variant="inset" collapsible="offcanvas">
        <SidebarHeader size="chrome">
          <div className={APP_CHROME_HEADER_CLASS}>
            <SidebarChromeTrigger when="sidebar" />
            <SidebarBrandMark />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem data-tour="nav-services">
                  <ServicesSidebarMenuItem />
                </SidebarMenuItem>
                {peopleNavEnabled ? (
                  <SidebarMenuItem data-tour="nav-people">
                    <SidebarMenuButton
                      render={<Link to="/people" />}
                      isActive={pathname.startsWith("/people")}
                      tooltip="People"
                    >
                      <SidebarNavIcon icon={UsersIcon} />
                      <span>People</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : null}
                {songsNavEnabled ? (
                  <SidebarMenuItem data-tour="nav-songs">
                    <SidebarMenuButton
                      render={<Link to="/songs" />}
                      isActive={pathname.startsWith("/songs")}
                      tooltip="Songs"
                    >
                      <SidebarNavIcon icon={MusicNote03Icon} />
                      <span>Songs</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : null}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="border-sidebar-border/50 flex flex-col gap-2 border-t pt-2">
            <SidebarMenu>
              <SidebarFeedback />
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  tooltip="Shortcuts"
                  onClick={() => {
                    setShortcutsOpen(true);
                  }}
                >
                  <SidebarNavIcon icon={Settings02Icon} />
                  <span>Shortcuts</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <SidebarAccountPanel
              onOpenShortcuts={() => {
                setShortcutsOpen(true);
              }}
            />
          </div>
        </SidebarFooter>
      </Sidebar>
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Shortcuts</DialogTitle>
            <DialogDescription>
              Keyboard shortcuts available in pcobooster.com.
            </DialogDescription>
          </DialogHeader>
          <ShortcutList shortcuts={APP_SHORTCUTS} />
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">Plan builder</h3>
            <ShortcutList shortcuts={PLAN_BUILDER_SHORTCUTS} />
          </section>
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">Song files</h3>
            <ShortcutList shortcuts={FILE_DIALOG_SHORTCUTS} />
          </section>
          {practiceEnabled ? (
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">Practice</h3>
              <ShortcutList shortcuts={PRACTICE_SHORTCUTS} />
            </section>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
};

/** Visitors on a demo link need to know why nothing they change sticks. */
const DemoBadge = () => {
  const { data } = useAccountsQuery();
  if (data?.demo !== true) {
    return null;
  }
  return (
    <HoverLabel
      label="Explore freely. Changes aren’t saved."
      side="bottom"
      align="end"
      sideOffset={8}
      render={<Badge variant="secondary" className="ml-auto" />}
    >
      Read-only demo
    </HoverLabel>
  );
};

const PresentationModeBadge = () => (
  <span className="bg-status-scheduled/10 text-status-scheduled ml-auto shrink-0 rounded-md px-2 py-1 text-xs font-medium">
    <span className="md:hidden">Presenting</span>
    <span className="max-md:hidden">Presentation mode</span>
  </span>
);

const mobileBackLinkClassName = buttonVariants({
  variant: "ghost",
  size: "lg",
  className: "-ml-2 min-w-0 gap-0.5 pl-1.5 text-base",
});

/** Back to the section, or from a song's chart back to the song. */
const MobileBackLink = ({ detail }: { detail: DetailRoute }) => {
  const songTitle = useSongTitle(detail.songId);
  if (detail.songSubpage !== null) {
    return (
      <Link
        to="/songs/$songId"
        params={{ songId: detail.songSubpage.songId }}
        search={(previous) => previous}
        className={mobileBackLinkClassName}
      >
        <ChevronLeft className="size-5" aria-hidden />
        <span className="truncate">{songTitle ?? detail.label}</span>
      </Link>
    );
  }
  return (
    <Link to={detail.parentHref} className={mobileBackLinkClassName}>
      <ChevronLeft className="size-5" aria-hidden />
      {detail.parentLabel}
    </Link>
  );
};

/**
 * Phone header for sections and detail pages. Plan workspaces render their own
 * header with the plan title, so this stays out of the way there.
 */
const MobileChromeHeader = () => {
  const pathname = usePathname();
  const planRoute = usePlanRoute();
  if (planRoute !== null) {
    return null;
  }
  const detail = parseDetailRoute(pathname);

  return (
    <MobileHeader>
      {detail ? (
        <MobileBackLink detail={detail} />
      ) : (
        <p className="text-lg font-semibold tracking-tight">
          {getAppSectionLabel(getAppSection(pathname))}
        </p>
      )}
      <DemoBadge />
      {presentationMode ? <PresentationModeBadge /> : null}
    </MobileHeader>
  );
};

/** The page, unless the account can't open Services and every page would fail. */
const AppShellContent = ({ children }: { children: ReactNode }): ReactNode => {
  const { noServicesAccess } = useAccessReview();
  return noServicesAccess ? <NoServicesAccess /> : children;
};

const rootRoute = getRouteApi("__root__");

/** Navigation chrome around every signed-in product page. */
export const AppShell = ({ children }: { children: ReactNode }): ReactNode => {
  const { sidebarDefaultOpen } = rootRoute.useLoaderData();
  const { peopleNavEnabled, songsNavEnabled } = useNavFeatures();

  return (
    <AccessReviewProvider>
      <SidebarProvider
        defaultOpen={sidebarDefaultOpen}
        className="min-h-dvh md:h-dvh md:min-h-0 md:overflow-hidden"
      >
        <OnboardingProvider>
          <SidebarToggleHotkey />
          <AppSidebar
            peopleNavEnabled={peopleNavEnabled}
            songsNavEnabled={songsNavEnabled}
          />
          <SidebarInset className="@container md:min-h-0 md:overflow-hidden">
            <AppInsetChromeHeader>
              <SidebarChromeTrigger when="inset" />
              <AppTopBar />
              <DemoBadge />
              {presentationMode ? <PresentationModeBadge /> : null}
            </AppInsetChromeHeader>
            <MobileChromeHeader />
            <div className="page-gutters flex flex-1 flex-col md:min-h-0">
              <AppShellContent>{children}</AppShellContent>
            </div>
          </SidebarInset>
        </OnboardingProvider>
      </SidebarProvider>
    </AccessReviewProvider>
  );
};
