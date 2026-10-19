import Calendar04Icon from "@hugeicons/core-free-icons/Calendar04Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import DashboardSquare01Icon from "@hugeicons/core-free-icons/DashboardSquare01Icon";
import Layout3ColumnIcon from "@hugeicons/core-free-icons/Layout3ColumnIcon";
import ListMusicIcon from "@hugeicons/core-free-icons/ListMusicIcon";
import Moon02Icon from "@hugeicons/core-free-icons/Moon02Icon";
import MusicNote03Icon from "@hugeicons/core-free-icons/MusicNote03Icon";
import Sun01Icon from "@hugeicons/core-free-icons/Sun01Icon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import UsersIcon from "@hugeicons/core-free-icons/UsersIcon";
import type { IconSvgElement } from "@hugeicons/react";
import { ChevronLeft, ChevronRight, Menu, RotateCcw, X } from "lucide-react";
import { useState } from "react";

import { DemoButton } from "../ui/demo-control";
import { AssignView, CandidateList } from "./assign-view";
import { resetChordCharts } from "./chart-model";
import { ChordChartView } from "./chord-chart-view";
import {
  navigateDemo,
  resetAssignments,
  useDemoRoute,
  isPlanView,
} from "./demo-model";
import type { DemoView, PlanView as PlanViewId } from "./demo-model";
import { DemoIcon } from "./demo-parts";
import { plan } from "./fixtures";
import { LineupView } from "./lineup-view";
import { OverviewView } from "./overview-view";
import { PeopleView } from "./people-view";
import { resetPlan } from "./plan-model";
import { PlanView } from "./plan-view";
import { ServicesView } from "./services-view";
import { SongsView } from "./songs-view";
import { TimesView } from "./times-view";

import styles from "./product-demo.module.css";

interface ViewEntry<Id extends DemoView> {
  readonly id: Id;
  readonly label: string;
  readonly icon: IconSvgElement;
}

/** The plan's views, in the order the product lists them. */
const planViews: readonly ViewEntry<PlanViewId>[] = [
  { id: "overview", label: "Overview", icon: DashboardSquare01Icon },
  { id: "assign", label: "Assign", icon: UserAdd01Icon },
  { id: "lineup", label: "Lineup", icon: Layout3ColumnIcon },
  { id: "plan", label: "Plan", icon: ListMusicIcon },
  { id: "times", label: "Times", icon: Clock01Icon },
];

const sections: readonly ViewEntry<"people" | "songs">[] = [
  { id: "people", label: "People", icon: UsersIcon },
  { id: "songs", label: "Songs", icon: MusicNote03Icon },
];

const resetDemo = () => {
  resetAssignments();
  resetPlan();
  resetChordCharts();
};

const viewLabel = (view: DemoView) =>
  view === "services"
    ? "Services"
    : ([...planViews, ...sections].find((entry) => entry.id === view)?.label ??
      "");

const PlanTitle = () => (
  <h2 className={styles["plan-heading"]}>
    <strong>{plan.serviceType}</strong>
    <span> / {plan.title}</span>
    <span> / {plan.when}</span>
  </h2>
);

const Sidebar = ({
  view,
  dark,
  onToggleTheme,
}: {
  view: DemoView;
  dark: boolean;
  onToggleTheme: () => void;
}) => (
  <aside className={styles.sidebar}>
    <p className={styles["sidebar-brand"]}>
      <strong>PCO</strong>Booster
    </p>
    <nav aria-label="Demo navigation">
      <ul className={styles["sidebar-list"]}>
        <li>
          <DemoButton
            variant="nav"
            aria-current={view === "services" ? "page" : undefined}
            onClick={() => {
              navigateDemo({ view: "services" });
            }}
          >
            <DemoIcon icon={Calendar04Icon} />
            Services
          </DemoButton>
          {isPlanView(view) ? (
            <ul className={styles["sidebar-sub"]}>
              {planViews.map((entry) => (
                <li key={entry.id}>
                  <DemoButton
                    variant="nav"
                    aria-current={entry.id === view ? "page" : undefined}
                    onClick={() => {
                      navigateDemo({ view: entry.id });
                    }}
                  >
                    <DemoIcon icon={entry.icon} />
                    {entry.label}
                  </DemoButton>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
        {sections.map((entry) => (
          <li key={entry.id}>
            <DemoButton
              variant="nav"
              aria-current={entry.id === view ? "page" : undefined}
              onClick={() => {
                navigateDemo({ view: entry.id, songId: null });
              }}
            >
              <DemoIcon icon={entry.icon} />
              {entry.label}
            </DemoButton>
          </li>
        ))}
      </ul>
    </nav>
    <div className={styles["sidebar-footer"]}>
      <DemoButton variant="nav" onClick={onToggleTheme}>
        <DemoIcon icon={dark ? Sun01Icon : Moon02Icon} />
        {dark ? "Light mode" : "Dark mode"}
      </DemoButton>
      <DemoButton variant="nav" onClick={resetDemo}>
        <RotateCcw className={styles.icon} aria-hidden />
        Reset demo
      </DemoButton>
    </div>
  </aside>
);

/** The app shell's breadcrumb: the section, then the open chord chart. */
const Crumbs = ({ view, songId }: { view: DemoView; songId: string | null }) =>
  view === "songs" && songId !== null ? (
    <span className={styles.crumbs}>
      <DemoButton
        variant="ghost"
        onClick={() => {
          navigateDemo({ songId: null });
        }}
      >
        Songs
      </DemoButton>
      <ChevronRight className={styles["crumb-separator"]} aria-hidden />
      <strong>Chord chart</strong>
    </span>
  ) : (
    <span className={styles.crumbs}>
      <strong>{viewLabel(view)}</strong>
    </span>
  );

/** The header's plan view tabs, with each view's icon beside its label. */
const PlanViewTabs = ({ view }: { view: DemoView }) => (
  <nav className={styles["header-tabs"]} aria-label="Plan views">
    {planViews.map((entry) => (
      <DemoButton
        key={entry.id}
        variant="header-tab"
        aria-current={entry.id === view ? "page" : undefined}
        onClick={() => {
          navigateDemo({ view: entry.id });
        }}
      >
        <DemoIcon icon={entry.icon} />
        {entry.label}
      </DemoButton>
    ))}
  </nav>
);

/** The phone's plan view switcher: one even row of icon-over-label tabs. */
const PhonePlanTabs = ({ view }: { view: DemoView }) => (
  <nav className={styles["phone-tabs"]} aria-label="Plan views">
    {planViews.map((entry) => (
      <DemoButton
        key={entry.id}
        variant="phone-tab"
        aria-current={entry.id === view ? "page" : undefined}
        onClick={() => {
          navigateDemo({ view: entry.id });
        }}
      >
        <DemoIcon icon={entry.icon} />
        {entry.label}
      </DemoButton>
    ))}
  </nav>
);

/** The product's phone plan header: back, two-line plan title, and the menu button. */
const PhoneHeader = ({
  view,
  menuOpen,
  onToggleMenu,
}: {
  view: DemoView;
  menuOpen: boolean;
  onToggleMenu: () => void;
}) => (
  <header className={styles["phone-header"]}>
    {isPlanView(view) ? (
      <>
        <ChevronLeft className={styles.icon} aria-hidden />
        <div className={styles["phone-title"]}>
          <strong>{plan.title}</strong>
          <span>
            {plan.when} · {plan.serviceType}
          </span>
        </div>
      </>
    ) : (
      <div className={styles["phone-title"]}>
        <strong>{viewLabel(view)}</strong>
      </div>
    )}
    <span className={styles["sample-badge"]}>Sample</span>
    <DemoButton
      variant="icon"
      aria-label={menuOpen ? "Close demo menu" : "Open demo menu"}
      aria-expanded={menuOpen}
      onClick={onToggleMenu}
    >
      {menuOpen ? (
        <X className={styles.icon} aria-hidden />
      ) : (
        <Menu className={styles.icon} aria-hidden />
      )}
    </DemoButton>
  </header>
);

/** The product's full-screen phone menu, scoped to the replica. */
const PhoneMenu = ({
  view,
  dark,
  onToggleTheme,
  onClose,
}: {
  view: DemoView;
  dark: boolean;
  onToggleTheme: () => void;
  onClose: () => void;
}) => (
  <nav className={styles["phone-menu"]} aria-label="Demo menu">
    <ul>
      <li>
        <DemoButton
          variant="nav"
          aria-current={
            isPlanView(view) || view === "services" ? "page" : undefined
          }
          onClick={() => {
            navigateDemo({ view: "services" });
            onClose();
          }}
        >
          <DemoIcon icon={Calendar04Icon} />
          Services
        </DemoButton>
      </li>
      {sections.map((entry) => (
        <li key={entry.id}>
          <DemoButton
            variant="nav"
            aria-current={entry.id === view ? "page" : undefined}
            onClick={() => {
              navigateDemo({ view: entry.id, songId: null });
              onClose();
            }}
          >
            <DemoIcon icon={entry.icon} />
            {entry.label}
          </DemoButton>
        </li>
      ))}
    </ul>
    <ul className={styles["phone-menu-footer"]}>
      <li>
        <DemoButton
          variant="nav"
          onClick={() => {
            onToggleTheme();
            onClose();
          }}
        >
          <DemoIcon icon={dark ? Sun01Icon : Moon02Icon} />
          {dark ? "Light mode" : "Dark mode"}
        </DemoButton>
      </li>
      <li>
        <DemoButton
          variant="nav"
          onClick={() => {
            resetDemo();
            onClose();
          }}
        >
          <RotateCcw className={styles.icon} aria-hidden />
          Reset demo
        </DemoButton>
      </li>
    </ul>
  </nav>
);

/** The full clickable replica: app shell, the plan's views, People, and Songs. */
export const ProductDemo = () => {
  const { view, positionId, songId } = useDemoRoute();
  const [dark, setDark] = useState(false);
  const [phoneMenuOpen, setPhoneMenuOpen] = useState(false);
  const toggleTheme = () => {
    setDark((value) => !value);
  };

  return (
    <div className={`${styles.demo} ${dark ? "dark" : ""}`} data-demo-root="">
      <Sidebar view={view} dark={dark} onToggleTheme={toggleTheme} />
      <div className={styles.inset}>
        <header className={styles.topbar}>
          {isPlanView(view) ? (
            <PlanViewTabs view={view} />
          ) : (
            <Crumbs view={view} songId={songId} />
          )}
          <span className={styles["sample-badge"]}>Sample data</span>
        </header>
        <PhoneHeader
          view={view}
          menuOpen={phoneMenuOpen}
          onToggleMenu={() => {
            setPhoneMenuOpen((open) => !open);
          }}
        />
        {isPlanView(view) ? <PhonePlanTabs view={view} /> : null}
        {phoneMenuOpen ? (
          <PhoneMenu
            view={view}
            dark={dark}
            onToggleTheme={toggleTheme}
            onClose={() => {
              setPhoneMenuOpen(false);
            }}
          />
        ) : null}
        <div className={styles.content} data-view={view}>
          {isPlanView(view) ? <PlanTitle /> : null}
          {view === "overview" ? <OverviewView /> : null}
          {view === "assign" ? (
            <AssignView
              positionId={positionId}
              onSelectPosition={(id) => {
                navigateDemo({ positionId: id });
              }}
            />
          ) : null}
          {view === "lineup" ? (
            <LineupView
              onOpenPosition={(id) => {
                navigateDemo({ view: "assign", positionId: id });
              }}
            />
          ) : null}
          {view === "plan" ? <PlanView /> : null}
          {view === "times" ? <TimesView /> : null}
          {view === "services" ? <ServicesView /> : null}
          {view === "people" ? <PeopleView /> : null}
          {view === "songs" && songId === null ? <SongsView /> : null}
          {view === "songs" && songId !== null ? (
            <ChordChartView songId={songId} />
          ) : null}
        </div>
      </div>
    </div>
  );
};

/** Lineup board on its own; open spots jump the hero replica into Assign. */
export const LineupShowcase = ({ demoAnchorId }: { demoAnchorId: string }) => (
  <div className={`${styles.demo} ${styles.embedded}`}>
    <div className={styles.content}>
      <LineupView
        onOpenPosition={(id) => {
          navigateDemo({ view: "assign", positionId: id });
          document
            .querySelector(`#${demoAnchorId}`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />
    </div>
  </div>
);

/** A few Acoustic Guitar candidates with one person's busiest recent day open. */
export const HistoryShowcase = () => (
  <div className={`${styles.demo} ${styles.embedded}`}>
    <div className={styles.content}>
      <h3 className={styles["position-heading"]}>
        Acoustic Guitar<span>Band</span>
      </h3>
      <CandidateList
        positionId="acoustic"
        limit={4}
        compact
        openHistoryFor={{ personId: "p01", offset: -21 }}
      />
    </div>
  </div>
);

/** Team health and the three check-in lists, without the app shell or the table. */
export const PeopleShowcase = () => (
  <div className={`${styles.demo} ${styles.embedded}`}>
    <div className={styles.content}>
      <PeopleView compact />
    </div>
  </div>
);

/** The chord chart editor for the sample's opening song. */
export const ChordChartShowcase = () => (
  <div className={`${styles.demo} ${styles.embedded}`}>
    <div className={styles.content}>
      <ChordChartView songId="s1" />
    </div>
  </div>
);
