import accessMe from "./fixtures/access.me.json";
import accountsList from "./fixtures/accounts.list.json";
import accountsSelect from "./fixtures/accounts.select.json";
import catalogAdjacentPlans from "./fixtures/catalog.adjacentPlans.json";
import catalogOrganization from "./fixtures/catalog.organization.json";
import catalogPlan from "./fixtures/catalog.plan.json";
import catalogPlans from "./fixtures/catalog.plans.json";
import catalogServiceTypes from "./fixtures/catalog.serviceTypes.json";
import catalogTeamPositions from "./fixtures/catalog.teamPositions.json";
import chordChartsCreate from "./fixtures/chordCharts.create.json";
import chordChartsCreateSong from "./fixtures/chordCharts.createSong.json";
import chordChartsLyricsSearch from "./fixtures/chordCharts.lyricsSearch.json";
import chordChartsPdf from "./fixtures/chordCharts.pdf.json";
import chordChartsSong from "./fixtures/chordCharts.song.json";
import chordChartsUpdate from "./fixtures/chordCharts.update.json";
import demoExit from "./fixtures/demo.exit.json";
import demoStart from "./fixtures/demo.start.json";
import featuresStatus from "./fixtures/features.status.json";
import feedbackSubmit from "./fixtures/feedback.submit.json";
import health from "./fixtures/health.json";
import neededPositionsAdjust from "./fixtures/neededPositions.adjust.json";
import peopleBlockouts from "./fixtures/people.blockouts.json";
import peopleCandidateDetails from "./fixtures/people.candidateDetails.json";
import peopleDashboardActivity from "./fixtures/people.dashboardActivity.json";
import peopleDashboardPerson from "./fixtures/people.dashboardPerson.json";
import peopleDashboardRoster from "./fixtures/people.dashboardRoster.json";
import peopleMyScheduledPlans from "./fixtures/people.myScheduledPlans.json";
import peoplePlanWindowHistory from "./fixtures/people.planWindowHistory.json";
import peoplePositionCandidates from "./fixtures/people.positionCandidates.json";
import peopleSearch from "./fixtures/people.search.json";
/**
 * The fixture for each procedure: the Swift app's fictional fixtures
 * (`<namespace>.<procedure>.json`), copied as written. Each file is
 * `{"default": <output>, "cases": [{"match": <input subset>, "output": <output>}]}`. A test
 * checks each name is a procedure and each output decodes as its success.
 */
import planFilesList from "./fixtures/planFiles.list.json";
import planItemsCreate from "./fixtures/planItems.create.json";
import planItemsDelete from "./fixtures/planItems.delete.json";
import planItemsList from "./fixtures/planItems.list.json";
import planItemsReorder from "./fixtures/planItems.reorder.json";
import planItemsUpdate from "./fixtures/planItems.update.json";
import planPeopleUpdateTimes from "./fixtures/planPeople.updateTimes.json";
import planTimesCreate from "./fixtures/planTimes.create.json";
import planTimesDelete from "./fixtures/planTimes.delete.json";
import planTimesList from "./fixtures/planTimes.list.json";
import planTimesUpdate from "./fixtures/planTimes.update.json";
import scheduleAssign from "./fixtures/schedule.assign.json";
import scheduleRemove from "./fixtures/schedule.remove.json";
import scheduleUpdateStatus from "./fixtures/schedule.updateStatus.json";
import sessionStatus from "./fixtures/session.status.json";
import songsAttachmentLink from "./fixtures/songs.attachmentLink.json";
import songsAttachments from "./fixtures/songs.attachments.json";
import songsHistory from "./fixtures/songs.history.json";
import songsLibrary from "./fixtures/songs.library.json";
import songsOptions from "./fixtures/songs.options.json";
import songsSchedule from "./fixtures/songs.schedule.json";
import songsSearch from "./fixtures/songs.search.json";
import songsSuggestions from "./fixtures/songs.suggestions.json";

export const fixtureFiles = {
  "planFiles.list": planFilesList,
  "planFiles.open": {
    default: {
      ...chordChartsPdf.default,
      url: "https://fixtures.invalid/attachments/88005",
      preview: false,
    },
    cases: [
      {
        match: { attachmentId: "88001" },
        output: {
          url: "https://fixtures.invalid/attachments/88001",
          preview: false,
        },
      },
      {
        match: { attachmentId: "88004" },
        output: {
          url: "https://fixtures.invalid/attachments/88004",
          preview: false,
        },
      },
    ],
  },
  "access.me": accessMe,
  "accounts.list": accountsList,
  "accounts.select": accountsSelect,
  "catalog.adjacentPlans": catalogAdjacentPlans,
  "catalog.organization": catalogOrganization,
  "catalog.plan": catalogPlan,
  "catalog.plans": catalogPlans,
  "catalog.serviceTypes": catalogServiceTypes,
  "catalog.teamPositions": catalogTeamPositions,
  "chordCharts.create": chordChartsCreate,
  "chordCharts.createSong": chordChartsCreateSong,
  "chordCharts.lyricsSearch": chordChartsLyricsSearch,
  "chordCharts.pdf": chordChartsPdf,
  "chordCharts.song": chordChartsSong,
  "chordCharts.update": chordChartsUpdate,
  "demo.exit": demoExit,
  "demo.start": demoStart,
  "features.status": featuresStatus,
  "feedback.submit": feedbackSubmit,
  "health.get": health,
  "neededPositions.adjust": neededPositionsAdjust,
  "people.blockouts": peopleBlockouts,
  "people.candidateDetails": peopleCandidateDetails,
  "people.dashboardActivity": peopleDashboardActivity,
  "people.dashboardPerson": peopleDashboardPerson,
  "people.dashboardRoster": peopleDashboardRoster,
  "people.myScheduledPlans": peopleMyScheduledPlans,
  "people.planWindowHistory": peoplePlanWindowHistory,
  "people.positionCandidates": peoplePositionCandidates,
  "people.search": peopleSearch,
  "planItems.create": planItemsCreate,
  "planItems.delete": planItemsDelete,
  "planItems.list": planItemsList,
  "planItems.reorder": planItemsReorder,
  "planItems.update": planItemsUpdate,
  "planPeople.updateTimes": planPeopleUpdateTimes,
  "planTimes.create": planTimesCreate,
  "planTimes.delete": planTimesDelete,
  "planTimes.list": planTimesList,
  "planTimes.update": planTimesUpdate,
  "schedule.assign": scheduleAssign,
  "schedule.remove": scheduleRemove,
  "schedule.updateStatus": scheduleUpdateStatus,
  "session.status": sessionStatus,
  "songs.attachmentLink": songsAttachmentLink,
  "songs.attachments": songsAttachments,
  "songs.history": songsHistory,
  "songs.library": songsLibrary,
  "songs.options": songsOptions,
  "songs.schedule": songsSchedule,
  "songs.search": songsSearch,
  "songs.suggestions": songsSuggestions,
};
