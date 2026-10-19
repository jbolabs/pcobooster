import type { TourStep } from "@/components/onboarding/guided-tour";

/** The app tour, on Services: where each part of the product lives. */
export const appTourSteps: readonly TourStep[] = [
  {
    target: "nav-services",
    title: "Services",
    body: "Your home base. Every upcoming plan for the service types you can see in Planning Center.",
  },
  {
    target: "your-services",
    title: "Plans you’re on",
    body: "Services you’re scheduled for are pinned here. Open one to jump straight into its plan.",
    side: "bottom",
  },
  {
    target: "plan-search",
    title: "Find a plan",
    body: "Scroll down for later plans or up for earlier ones. Search loaded plans by name, series, or date, or narrow by service type. Open a plan to build its run sheet and schedule its teams.",
    side: "bottom",
  },
  {
    target: "nav-people",
    title: "People",
    body: "Team health: who to check in with, who’s serving too often, and who is due to serve.",
  },
  {
    target: "nav-songs",
    title: "Songs",
    body: "Your Planning Center song library. Open a song to see its arrangements, files, and schedule, and to write its chord chart.",
  },
  {
    target: "mobile-menu",
    title: "Menu",
    body: "Services, People, Songs, Feedback, and your account all live behind this menu.",
    side: "bottom",
  },
  {
    target: "feedback",
    title: "Tell us what’s missing",
    body: "pcobooster.com is in beta. Feedback goes straight to the people building it, and we read every note.",
  },
  {
    target: "account-menu",
    title: "Your account",
    body: "Appearance, your Planning Center access, keyboard shortcuts, and this guide whenever you want it again.",
    side: "top",
  },
];

/** The plan tour, the first time someone opens a plan: what each view is for. */
export const planTourSteps: readonly TourStep[] = [
  {
    target: "plan-view-plan",
    title: "Plan",
    body: "The run sheet. Add songs, headers, and items, drag to reorder, and set keys and lengths inline. Press / to add a song.",
    side: "bottom",
  },
  {
    target: "plan-view-assign",
    title: "Assign",
    body: "Pick an open position to see who’s available, rested, and a good fit, then schedule them in one click.",
    side: "bottom",
  },
  {
    target: "plan-view-lineup",
    title: "Lineup",
    body: "Every team’s filled and open roles. Open a role to fill it, or mark responses, remove someone, and swap in someone else.",
    side: "bottom",
  },
  {
    target: "plan-view-times",
    title: "Times",
    body: "Service and rehearsal times, and who each one involves.",
    side: "bottom",
  },
  {
    target: "plan-view-overview",
    title: "Overview",
    body: "A readiness checklist: open positions, unanswered requests, songs without a key, and missing times.",
    side: "bottom",
  },
  {
    target: "plan-stepper",
    title: "Next and previous plans",
    body: "Step through this service’s plans without going back to the list. [ and ] do the same from the keyboard.",
    side: "bottom",
  },
  {
    target: "open-in-planning-center",
    title: "Open in Planning Center",
    body: "Everything here saves to Planning Center. For anything we don’t cover yet, open this plan there.",
    side: "bottom",
  },
];
