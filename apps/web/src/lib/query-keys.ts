export const scheduleMutationKey = ["schedule-write"] as const;

export const queryKeys = {
  accounts: () => ["planning-center-accounts"] as const,
  /** The signed-in person's Planning Center permissions in one linked account. */
  planningCenterAccess: (accountId: string | null) =>
    ["planning-center-access", accountId] as const,
  features: () => ["features"] as const,
  organizationTimeZone: () =>
    ["planning-center-organization-time-zone"] as const,
  serviceTypes: () => ["service-types"] as const,
  plans: (serviceTypeId: string | null) => ["plans", serviceTypeId] as const,
  planWindow: (serviceTypeId: string, startDay: string, days: "14" | "30") =>
    ["plans", serviceTypeId, "window", startDay, days] as const,
  planDetails: (serviceTypeId: string, planId: string) =>
    ["plan-details", serviceTypeId, planId] as const,
  adjacentPlans: (
    serviceTypeId: string,
    planId: string,
    direction: "previous" | "next"
  ) => ["adjacent-plans", serviceTypeId, planId, direction] as const,
  teamPositions: (
    serviceTypeId: string | null,
    planId: string | null,
    _seriesId: string | null
  ) => ["team-positions", serviceTypeId, planId] as const,
  /** Candidates for one slot, with the selected plan's roster; schedule writes patch these. */
  positionCandidates: (
    serviceTypeId: string | null,
    teamId: string | null,
    positionId: string | null,
    planId: string | null
  ) => ["people", serviceTypeId, teamId, positionId, planId] as const,
  planWindowHistory: (dateKey: string) =>
    ["people-plan-window-history", dateKey] as const,
  /** `historyPlanId` is set only when the details carry schedule history for that plan. */
  candidateDetails: (
    dateKey: string,
    historyPlanId: string | null,
    personIds: readonly string[]
  ) =>
    ["people-candidate-details", dateKey, historyPlanId, ...personIds] as const,
  peopleSearch: (query: string) => ["people-search", query] as const,
  peopleDashboardRoster: () => ["people-dashboard-roster"] as const,
  peopleDashboardActivity: (personIds: readonly string[]) =>
    ["people-dashboard-activity", ...personIds] as const,
  peopleDashboardPerson: (personId: string, month: string | null) =>
    ["people-dashboard-person", personId, month] as const,
  blockouts: (personId: string | null) => ["blockouts", personId] as const,
  myScheduledPlans: () => ["my-scheduled-plans"] as const,
  planItems: (serviceTypeId: string | null, planId: string | null) =>
    ["plan-items", serviceTypeId, planId] as const,
  planFiles: (serviceTypeId: string, planId: string) =>
    ["plan-files", serviceTypeId, planId] as const,
  planFileLink: (
    serviceTypeId: string,
    planId: string,
    fileId: string,
    as: string
  ) => ["plan-file-link", serviceTypeId, planId, fileId, as] as const,
  planTimes: (serviceTypeId: string | null, planId: string | null) =>
    ["plan-times", serviceTypeId, planId] as const,
  songSearch: (query: string) => ["song-search", query] as const,
  songLibrary: () => ["song-library"] as const,
  songSuggestions: () => ["song-suggestions"] as const,
  songHistory: (songId: string | null) => ["song-history", songId] as const,
  songOptions: (songId: string | null, serviceTypeId: string | null) =>
    ["song-options", songId, serviceTypeId] as const,
  songAttachments: (songId: string, arrangementId: string) =>
    ["song-attachments", songId, arrangementId] as const,
  /** A signed link, read fresh on each open and never kept. */
  songAttachmentLink: (
    songId: string,
    arrangementId: string,
    attachmentId: string
  ) => ["song-attachment-link", songId, arrangementId, attachmentId] as const,
  chordChartSong: (songId: string) => ["chord-chart-song", songId] as const,
  lyricsSearch: (query: string) => ["lyrics-search", query] as const,
  /** Keyed by the saved version, so each save renders again. */
  chordChartPdf: (
    arrangementId: string,
    keyId: string | null,
    updatedAt: string | null
  ) => ["chord-chart-pdf", arrangementId, keyId, updatedAt] as const,
} as const;
