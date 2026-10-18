import { adjustPlanNeededPositions } from "@pcobooster/api/application/needed-positions";
import {
  readPlanFileLink,
  readPlanFiles,
} from "@pcobooster/api/application/plan-files";
import {
  commitRunSheetItemCreate,
  commitRunSheetItemUpdate,
  createRunSheetTime,
  deleteRunSheetItem,
  deleteRunSheetTime,
  listPlanItems,
  listPlanTimes,
  prepareRunSheetItemCreate,
  prepareRunSheetItemUpdate,
  reorderRunSheetItems,
  updateRunSheetPersonTimes,
  updateRunSheetTime,
} from "@pcobooster/api/application/run-sheet";
import { preparedWrite } from "@pcobooster/api/http/write";
import { ProductApi } from "@pcobooster/contracts/http/api";
import { Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";

/** The plan page's run sheet: items, files, times, people's times, and open positions. */
export const RunSheetHandlers = Layer.mergeAll(
  HttpApiBuilder.group(ProductApi, "planItems", (handlers) =>
    handlers
      .handle("list", ({ params }) => listPlanItems(params))
      .handle("create", ({ params, payload }) =>
        preparedWrite(
          prepareRunSheetItemCreate({ ...params, ...payload }),
          commitRunSheetItemCreate
        )
      )
      .handle("update", ({ params, payload }) =>
        preparedWrite(
          prepareRunSheetItemUpdate({ ...params, ...payload }),
          commitRunSheetItemUpdate
        )
      )
      .handle("delete", ({ params }) => deleteRunSheetItem(params))
      .handle("reorder", ({ params, payload }) =>
        reorderRunSheetItems({ ...params, ...payload })
      )
  ),
  HttpApiBuilder.group(ProductApi, "planFiles", (handlers) =>
    handlers
      .handle("list", ({ params, query }) =>
        readPlanFiles({ ...params, ...query })
      )
      .handle("open", ({ params, query }) =>
        readPlanFileLink({ ...params, ...query })
      )
  ),
  HttpApiBuilder.group(ProductApi, "planTimes", (handlers) =>
    handlers
      .handle("list", ({ params }) => listPlanTimes(params))
      .handle("create", ({ params, payload }) =>
        createRunSheetTime({ ...params, ...payload })
      )
      .handle("update", ({ params, payload }) =>
        updateRunSheetTime({ ...params, ...payload })
      )
      .handle("delete", ({ params }) => deleteRunSheetTime(params))
  ),
  HttpApiBuilder.group(ProductApi, "planPeople", (handlers) =>
    handlers.handle("updateTimes", ({ params, payload }) =>
      updateRunSheetPersonTimes({ ...params, ...payload })
    )
  ),
  HttpApiBuilder.group(ProductApi, "neededPositions", (handlers) =>
    handlers.handle("adjust", ({ params, payload }) =>
      adjustPlanNeededPositions({ ...params, ...payload })
    )
  )
);
