import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

/** The certificate authorities Universal SSL may issue from; CAA records allow only these. */
const certificateAuthorities = [
  ["Google", "pki.goog"],
  ["Sectigo", "sectigo.com"],
  ["LetsEncrypt", "letsencrypt.org"],
] as const;

/** Restrict certificate issuance for a zone's apex (and its subdomains) to Universal SSL's CAs. */
export const allowUniversalSslIssuers = Effect.fn("allowUniversalSslIssuers")(
  function* allowUniversalSslIssuers(
    idPrefix: string,
    zone: Cloudflare.Zone.Zone,
    apex: string
  ) {
    for (const [id, issuer] of certificateAuthorities) {
      yield* Cloudflare.DNS.Record(`${idPrefix}CAA${id}`, {
        zoneId: zone.zoneId,
        name: apex,
        type: "CAA",
        content: { flags: 0, tag: "issue", value: issuer },
      });
    }
  }
);

/**
 * The id of a zone that must already exist in the account. The deploy tokens may not create
 * zones, so a missing zone stops the deploy here instead of failing on a permission error.
 */
export const existingZoneId = Effect.fn("existingZoneId")(
  function* existingZoneId(accountId: string, name: string) {
    const match = yield* Cloudflare.Zone.findZoneByName({
      accountId,
      name,
    }).pipe(Effect.orDie);
    if (match === undefined) {
      return yield* Effect.die(
        new Error(
          `Cloudflare zone ${name} does not exist in account ${accountId}. Add it by hand in ` +
            "the Cloudflare dashboard first."
        )
      );
    }
    return match.id;
  }
);

/** Paths only vulnerability scanners request; neither app serves any of them. */
const scannerProbePaths = [
  "/.env",
  "/.git/",
  "/.aws",
  "/wp-",
  ".php",
  ".sql",
  "/@fs/",
  "/_ignition/",
] as const;

/** Block requests for scanner probe paths before they reach a Worker. */
export const scannerProbeRule: Cloudflare.Ruleset.Rule = {
  description: "Block vulnerability scanner probes",
  expression: scannerProbePaths
    .map((probe) => `lower(http.request.uri.path) contains "${probe}"`)
    .join(" or "),
  action: "block",
  enabled: true,
};

/**
 * Free-plan edge protection for a zone: Bot Fight Mode and a custom WAF rule for scanner probes.
 * Blocked requests never invoke a Worker. Bot Fight Mode cannot be bypassed on the Free plan, so
 * any future inbound webhook must be checked against it. It challenges scripted clients on
 * datacenter networks: since October 13, 2026 that includes every GitHub runner, so CI verifies
 * production through its workers.dev origin and the Cloudflare API, never through this zone.
 *
 * The AI crawler policy blocks model-training crawlers and leaves AI search crawlers (such as
 * OAI-SearchBot and Claude-SearchBot) and assistant fetches unblocked, so the public pages can be
 * found and cited. `disabled` means Cloudflare takes no action on that class.
 */
export const protectZoneEdge = Effect.fn("protectZoneEdge")(
  function* protectZoneEdge(idPrefix: string, zone: Cloudflare.Zone.Zone) {
    yield* Cloudflare.BotManagement.BotManagement(`${idPrefix}BotManagement`, {
      zoneId: zone.zoneId,
      // Cloudflare rejects Bot Fight Mode unless JavaScript detections are on too.
      enableJs: true,
      fightMode: true,
      aiSearch: "disabled",
      aiUser: "disabled",
      aiTraining: "block",
    });
    // Owns the zone's whole custom firewall phase.
    yield* Cloudflare.Ruleset.Ruleset(`${idPrefix}Firewall`, {
      zone,
      phase: "http_request_firewall_custom",
      rules: [scannerProbeRule],
    });
  }
);
