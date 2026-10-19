import {
  faultClass,
  serverOnly,
} from "@pcobooster/contracts/faults/fault-class";
import { faultStatus } from "@pcobooster/contracts/faults/outcome";
import { Schema } from "effect";

export class InvalidInput extends faultClass<InvalidInput>()(
  "InvalidInput",
  {
    message: Schema.String,
    planningCenterValidation: Schema.optional(
      Schema.Struct({
        code: Schema.optional(
          Schema.Literals(["too_long", "invalid", "validation_error"])
        ),
        detail: Schema.Literals([
          "can not be longer than 24 hours",
          "Length must be a number",
        ]),
        field: Schema.Literal("length"),
      })
    ),

    /** Only a provider-confirmed 422 write rejection; never encoded for clients. */
    providerRejection: serverOnly(
      Schema.Struct({
        errors: Schema.Array(
          Schema.Struct({
            attribute: Schema.optional(Schema.String),
            detail: Schema.String,
          })
        ),
      })
    ),
  },
  faultStatus("InvalidInput")
) {}
