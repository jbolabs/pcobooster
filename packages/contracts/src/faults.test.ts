import { faultOutcome, productFaultSchema } from "@pcobooster/contracts/faults";
import type { ProductFaultTag } from "@pcobooster/contracts/faults";
import { AlreadyScheduled } from "@pcobooster/contracts/faults/already-scheduled";
import { ClientOutdated } from "@pcobooster/contracts/faults/client-outdated";
import { Conflict } from "@pcobooster/contracts/faults/conflict";
import { ExternalServiceFailure } from "@pcobooster/contracts/faults/external-service-failure";
import { Forbidden } from "@pcobooster/contracts/faults/forbidden";
import { InternalError } from "@pcobooster/contracts/faults/internal-error";
import { InvalidInput } from "@pcobooster/contracts/faults/invalid-input";
import { NotFound } from "@pcobooster/contracts/faults/not-found";
import { PersistenceFailure } from "@pcobooster/contracts/faults/persistence-failure";
import { PositionMismatch } from "@pcobooster/contracts/faults/position-mismatch";
import { RateLimited } from "@pcobooster/contracts/faults/rate-limited";
import { RequestRejected } from "@pcobooster/contracts/faults/request-rejected";
import { Unauthenticated } from "@pcobooster/contracts/faults/unauthenticated";
import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

const wire = Schema.toCodecJson(productFaultSchema);
const encode = Schema.encodeSync(wire);
const decode = Schema.decodeUnknownSync(wire);

const classStatus = (tag: string) =>
  productFaultSchema.members.find((fault) => fault.identifier === tag)?.ast
    .annotations?.httpApiStatus;

describe("faults on the wire", () => {
  it("never encodes server-only detail", () => {
    const invalid = new InvalidInput({
      message: "Planning Center didn't accept that change: Length is invalid",
      providerRejection: {
        errors: [{ attribute: "length", detail: "is invalid" }],
      },
    });
    const external = new ExternalServiceFailure({
      message: "Planning Center request failed.",
      service: "planning-center",
      cause: new Error("token=secret"),
    });
    const persistence = new PersistenceFailure({
      detail: "Could not load account data.",
      operation: "listAccounts",
      cause: new Error("D1_ERROR: no such table"),
    });

    expect(encode(external)).toStrictEqual({
      _tag: "ExternalServiceFailure",
      message: "Planning Center request failed.",
      service: "planning-center",
    });
    expect(encode(persistence)).toStrictEqual({
      _tag: "PersistenceFailure",
      message: "Internal server error",
    });
    expect(encode(invalid)).toStrictEqual({
      _tag: "InvalidInput",
      message: "Planning Center didn't accept that change: Length is invalid",
    });
    expect(decode(encode(invalid))).toBeInstanceOf(InvalidInput);
    expect(decode(encode(invalid))).not.toHaveProperty("providerRejection");
  });

  it("decodes each fault into its class, with the fixed persistence message", () => {
    const notFound = decode(
      encode(new NotFound({ message: "No plan", resource: "plan" }))
    );
    const persistence = decode(
      encode(new PersistenceFailure({ detail: "secret detail" }))
    );

    expect(notFound).toBeInstanceOf(NotFound);
    expect(persistence).toBeInstanceOf(PersistenceFailure);
    expect(persistence.message).toBe("Internal server error");
    expect(persistence).not.toHaveProperty("detail");
  });

  it("gives every fault, and only those, a status its class carries", () => {
    expectTypeOf<keyof typeof faultOutcome>().toEqualTypeOf<ProductFaultTag>();
    expect(
      productFaultSchema.members.map((fault) => [
        fault.identifier,
        fault.ast.annotations?.httpApiStatus,
      ])
    ).toStrictEqual(
      Object.entries(faultOutcome).map(([tag, { status }]) => [tag, status])
    );
  });

  it("answers each constructed fault with its pinned status and code", () => {
    const rows = [
      [new Unauthenticated({ message: "Sign in" }), 401, "UNAUTHORIZED"],
      [new Forbidden({ message: "No access" }), 403, "FORBIDDEN"],
      [new InvalidInput({ message: "Bad input" }), 400, "BAD_REQUEST"],
      [
        new RequestRejected({ message: "Rejected", reason: "invalid-payload" }),
        400,
        "BAD_REQUEST",
      ],
      [
        new ClientOutdated({ message: "Update", minimumProtocolVersion: 2 }),
        426,
        "CLIENT_OUTDATED",
      ],
      [
        new NotFound({ message: "No plan", resource: "plan" }),
        404,
        "NOT_FOUND",
      ],
      [new Conflict({ message: "Clash", reason: "stale" }), 409, "CONFLICT"],
      [
        new AlreadyScheduled({ message: "Already scheduled" }),
        409,
        "ALREADY_SCHEDULED",
      ],
      [
        new PositionMismatch({
          message: "Mismatch",
          details: {
            selected: {
              teamId: "t",
              teamName: "Band",
              positionId: "p",
              positionName: "Keys",
            },
            created: { planPersonId: "pp", teamPositionName: "Bass" },
          },
        }),
        409,
        "POSITION_MISMATCH",
      ],
      [
        new RateLimited({ message: "Slow down", service: "planning-center" }),
        429,
        "TOO_MANY_REQUESTS",
      ],
      [
        new ExternalServiceFailure({
          message: "Upstream failed",
          service: "planning-center",
        }),
        502,
        "BAD_GATEWAY",
      ],
      [
        new PersistenceFailure({ detail: "D1 failed" }),
        500,
        "INTERNAL_SERVER_ERROR",
      ],
      [new InternalError({}), 500, "INTERNAL_SERVER_ERROR"],
    ] as const;
    expect(
      rows.map(([fault]) => ({
        tag: fault._tag,
        status: classStatus(fault._tag),
        outcome: faultOutcome[fault._tag],
      }))
    ).toStrictEqual(
      rows.map(([fault, status, code]) => ({
        tag: fault.constructor.name,
        status,
        outcome: { status, code },
      }))
    );
  });
});
