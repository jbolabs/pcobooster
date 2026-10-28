import {
  accountsSelectInputSchema,
  accountSwitchSchema,
  planningCenterAccountsSchema,
} from "@pcobooster/contracts/http/accounts";
import { enabledFeaturesSchema } from "@pcobooster/contracts/http/features";
import { sessionStatusSchema } from "@pcobooster/contracts/http/session";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

const identity = {
  sub: "person-1",
  name: "A Person",
  email: null,
  organizationId: "organization-1",
  organizationName: "Organization",
};

describe("identity contracts", () => {
  it("retains the account panel view while excluding credential fields", () => {
    const panel = {
      session: {
        userId: "user-1",
        name: "A Person",
        email: "person@example.com",
        image: null,
      },
      selectedAccountId: "local-account-1",
      accounts: [
        {
          id: "local-account-1",
          providerId: "planning-center",
          updatedAt: "2026-09-19T00:00:00Z",
          identity,
        },
      ],
      demo: false,
    };
    const withCredentials = {
      ...panel,
      session: { ...panel.session, token: "private-session-token" },
      accounts: panel.accounts.map((account) => ({
        ...account,
        accessToken: "private-access-token",
        refreshToken: "private-refresh-token",
      })),
    };

    expect(
      Schema.decodeUnknownSync(planningCenterAccountsSchema)(withCredentials)
    ).toStrictEqual(panel);
    expect(
      Schema.decodeUnknownSync(planningCenterAccountsSchema)({
        ...panel,
        selectedAccountId: null,
        accounts: [],
      })
    ).toStrictEqual({ ...panel, selectedAccountId: null, accounts: [] });
    expect(
      Schema.decodeUnknownSync(planningCenterAccountsSchema)({
        ...panel,
        accounts: panel.accounts.map((account) => ({
          ...account,
          identity: null,
        })),
      }).accounts[0]?.identity
    ).toBeNull();
  });

  it("accepts anonymous and disabled results without requiring authentication", () => {
    expect(
      Schema.decodeUnknownSync(sessionStatusSchema)({ authenticated: false })
    ).toStrictEqual({
      authenticated: false,
    });
    expect(
      Schema.decodeUnknownSync(enabledFeaturesSchema)({
        people: false,
        chordCharts: false,
        practice: false,
      })
    ).toStrictEqual({ people: false, chordCharts: false, practice: false });
  });

  it("requires an answer for every feature flag and drops flags it does not know", () => {
    expect(() =>
      Schema.decodeUnknownSync(enabledFeaturesSchema)({ people: true })
    ).toThrow(Schema.SchemaError);
    expect(
      Schema.decodeUnknownSync(enabledFeaturesSchema)({
        people: true,
        chordCharts: true,
        practice: true,
        cleanup: true,
      })
    ).toStrictEqual({ people: true, chordCharts: true, practice: true });
  });

  it("requires a selected local account identifier and successful selection output", () => {
    expect(() =>
      Schema.decodeUnknownSync(accountsSelectInputSchema)({ accountId: " " })
    ).toThrow(Schema.SchemaError);
    expect(
      Schema.decodeUnknownSync(accountsSelectInputSchema)({
        accountId: "local-account-1",
      })
    ).toStrictEqual({ accountId: "local-account-1" });
    expect(() =>
      Schema.decodeUnknownSync(accountSwitchSchema)({
        success: false,
        selectedAccountId: "local-account-1",
      })
    ).toThrow(Schema.SchemaError);
  });
});
